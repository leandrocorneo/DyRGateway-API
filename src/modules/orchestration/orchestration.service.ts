import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import {
  DockerContainerSummary,
  getContainerIdentity,
  mapWithConcurrency,
  selectCanonicalContainers,
} from '../../monitoring/core/container';
import {
  ContainerAction,
  ContainerActionResponse,
  ContainerGroupActionResponse,
  ContainerGroupActionResult,
  ContainerOrchestrationPolicy,
  composeProjectGroupId,
  describeContainerGroupOrchestration,
  describeContainerOrchestration,
  summarizeContainerGroup,
} from './orchestration.types';

const execFileAsync = promisify(execFile);

type DockerContainerInspect = {
  Id?: string;
  State?: {
    Status?: string;
    StartedAt?: string;
    Health?: { Status?: string };
  };
};

export type DockerControlClient = {
  listContainers(): Promise<DockerContainerSummary[]>;
  inspectContainer(instanceId: string): Promise<DockerContainerInspect>;
  startContainer(instanceId: string): Promise<boolean>;
  stopContainer(instanceId: string, timeoutSeconds: number): Promise<boolean>;
  restartContainer?(instanceId: string, timeoutSeconds: number): Promise<boolean>;
};

export type ComposeProjectOperationInput = {
  project: string;
  workingDirectory: string;
  composeFile?: string;
  branch?: string | null;
  image?: string | null;
  canRestart?: boolean;
  canRebuild?: boolean;
  canRedeploy?: boolean;
  active?: boolean;
};

type ComposeProjectOperationRecord = Required<Pick<ComposeProjectOperationInput, 'project' | 'workingDirectory'>> & {
  id?: string;
  composeFile: string;
  branch: string | null;
  image: string | null;
  canRestart: boolean;
  canRebuild: boolean;
  canRedeploy: boolean;
  active: boolean;
};

type ComposeRunner = {
  run(project: ComposeProjectOperationRecord, action: 'rebuild' | 'redeploy'): Promise<void>;
};

type PersistedState = {
  instanceId: string;
  state: string;
  health: string | null;
  instanceStartedAt: Date | null;
};

type ServiceOptions = {
  client?: DockerControlClient;
  composeRunner?: ComposeRunner;
  policy?: ContainerOrchestrationPolicy;
  actionTimeoutMs?: number;
  composeActionTimeoutMs?: number;
  stopTimeoutSeconds?: number;
  groupActionConcurrency?: number;
  persistState?: (id: string, state: PersistedState) => Promise<void>;
  now?: () => Date;
};

export type OrchestrationErrorCode =
  | 'CONTAINER_PROTECTED'
  | 'CONTAINER_NOT_FOUND'
  | 'GROUP_NOT_FOUND'
  | 'ACTION_IN_PROGRESS'
  | 'UNSUPPORTED_CONTAINER_STATE'
  | 'COMPOSE_PROJECT_NOT_CONFIGURED'
  | 'COMPOSE_PROJECT_NOT_ALLOWED'
  | 'COMPOSE_RUNNER_ERROR'
  | 'DOCKER_DAEMON_ERROR'
  | 'DOCKER_ACTION_TIMEOUT';

export class OrchestrationError extends Error {
  constructor(
    public readonly statusCode: 403 | 404 | 409 | 502 | 504,
    public readonly code: OrchestrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const timeoutError = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return name === 'AbortError' || name === 'TimeoutError';
};

const mapDockerError = (status: number): OrchestrationError => {
  if (status === 404) return new OrchestrationError(404, 'CONTAINER_NOT_FOUND', 'Container no longer exists');
  if (status === 409) return new OrchestrationError(409, 'UNSUPPORTED_CONTAINER_STATE', 'Container state changed during the action');
  return new OrchestrationError(502, 'DOCKER_DAEMON_ERROR', 'Docker daemon rejected the operation');
};

export const createDockerControlClient = (
  proxyUrl = config.docker.proxyUrl,
  controlProxyUrl = config.docker.controlProxyUrl,
  actionTimeoutMs = config.docker.actionTimeoutMs,
  fetcher: typeof fetch = fetch,
): DockerControlClient => {
  const request = async <T>(baseUrl: string, path: string, method: 'GET' | 'POST' = 'GET'): Promise<{ response: Response; data: T | null }> => {
    let response: Response;
    try {
      response = await fetcher(baseUrl + path, {
        method,
        signal: AbortSignal.timeout(actionTimeoutMs),
      });
    } catch (error) {
      if (timeoutError(error)) throw new OrchestrationError(504, 'DOCKER_ACTION_TIMEOUT', 'Docker operation timed out');
      throw new OrchestrationError(502, 'DOCKER_DAEMON_ERROR', 'Docker daemon is unavailable');
    }

    if (!response.ok && response.status !== 304) throw mapDockerError(response.status);
    const data = response.status === 204 || response.status === 304
      ? null
      : await response.json() as T;
    return { response, data };
  };

  return {
    async listContainers() {
      const result = await request<DockerContainerSummary[]>(proxyUrl, '/containers/json?all=1&size=1');
      return result.data || [];
    },
    async inspectContainer(instanceId) {
      const result = await request<DockerContainerInspect>(proxyUrl, '/containers/' + encodeURIComponent(instanceId) + '/json');
      if (!result.data) throw new OrchestrationError(502, 'DOCKER_DAEMON_ERROR', 'Docker inspect returned no data');
      return result.data;
    },
    async startContainer(instanceId) {
      const result = await request<never>(controlProxyUrl, '/containers/' + encodeURIComponent(instanceId) + '/start', 'POST');
      return result.response.status !== 304;
    },
    async stopContainer(instanceId, timeoutSeconds) {
      const path = '/containers/' + encodeURIComponent(instanceId) + '/stop?t=' + encodeURIComponent(String(timeoutSeconds));
      const result = await request<never>(controlProxyUrl, path, 'POST');
      return result.response.status !== 304;
    },
    async restartContainer(instanceId, timeoutSeconds) {
      const path = '/containers/' + encodeURIComponent(instanceId) + '/restart?t=' + encodeURIComponent(String(timeoutSeconds));
      const result = await request<never>(controlProxyUrl, path, 'POST');
      return result.response.status !== 304;
    },
  };
};

const parseDockerDate = (value: string | undefined) => {
  if (!value || value.startsWith('0001-01-01')) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const defaultPersistState = async (id: string, state: PersistedState) => {
  await prisma.monitoredContainer.updateMany({
    where: { id, present: true },
    data: {
      currentContainerId: state.instanceId,
      state: state.state,
      health: state.health,
      instanceStartedAt: state.instanceStartedAt,
      lastSeenAt: new Date(),
    },
  });
};

const normalizeProjectInput = (data: Partial<ComposeProjectOperationInput>, partial = false) => {
  const project = data.project?.trim();
  const workingDirectory = data.workingDirectory?.trim();
  const composeFile = data.composeFile?.trim() || 'docker-compose.yml';
  if (!partial && (!project || !workingDirectory)) throw new Error('project and workingDirectory are required');
  if (project !== undefined && !project) throw new Error('project cannot be empty');
  if (workingDirectory !== undefined && !workingDirectory) throw new Error('workingDirectory cannot be empty');
  if (isAbsolute(composeFile)) throw new Error('composeFile must be relative to workingDirectory');
  if (composeFile.includes('..')) throw new Error('composeFile cannot traverse directories');
  return {
    ...(project !== undefined ? { project } : {}),
    ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    ...(data.composeFile !== undefined ? { composeFile } : {}),
    ...(data.branch !== undefined ? { branch: data.branch?.trim() || null } : {}),
    ...(data.image !== undefined ? { image: data.image?.trim() || null } : {}),
    ...(data.canRestart !== undefined ? { canRestart: Boolean(data.canRestart) } : {}),
    ...(data.canRebuild !== undefined ? { canRebuild: Boolean(data.canRebuild) } : {}),
    ...(data.canRedeploy !== undefined ? { canRedeploy: Boolean(data.canRedeploy) } : {}),
    ...(data.active !== undefined ? { active: Boolean(data.active) } : {}),
  };
};

const createLocalComposeRunner = (timeoutMs: number): ComposeRunner => ({
  async run(project, action) {
    const allowedRoots = config.docker.composeAllowedDirectories;
    if (!allowedRoots.length) throw new OrchestrationError(403, 'COMPOSE_PROJECT_NOT_ALLOWED', 'No Compose directories are allowed for operations');

    const workingDirectory = await realpath(project.workingDirectory).catch(() => null);
    if (!workingDirectory) throw new OrchestrationError(403, 'COMPOSE_PROJECT_NOT_ALLOWED', 'Compose working directory is not accessible');
    const allowed = await Promise.all(allowedRoots.map((item) => realpath(item).catch(() => resolve(item))));
    if (!allowed.some((root) => workingDirectory === root || workingDirectory.startsWith(root + '/'))) {
      throw new OrchestrationError(403, 'COMPOSE_PROJECT_NOT_ALLOWED', 'Compose working directory is outside the allowlist');
    }

    const baseArgs = ['compose', '-f', project.composeFile, '-p', project.project];
    const commands = action === 'rebuild'
      ? [[...baseArgs, 'build'], [...baseArgs, 'up', '-d']]
      : [[...baseArgs, 'pull'], [...baseArgs, 'up', '-d']];

    for (const args of commands) {
      try {
        await execFileAsync('docker', args, { cwd: workingDirectory, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ETIMEDOUT') throw new OrchestrationError(504, 'DOCKER_ACTION_TIMEOUT', 'Compose operation timed out');
        throw new OrchestrationError(502, 'COMPOSE_RUNNER_ERROR', 'Compose operation failed');
      }
    }
  },
});

export default class OrchestrationService {
  private readonly client: DockerControlClient;
  private readonly composeRunner: ComposeRunner;
  private readonly policy: ContainerOrchestrationPolicy;
  private readonly stopTimeoutSeconds: number;
  private readonly groupActionConcurrency: number;
  private readonly persistState: (id: string, state: PersistedState) => Promise<void>;
  private readonly now: () => Date;
  private readonly containerLocks = new Set<string>();
  private readonly groupLocks = new Set<string>();

  constructor(options: ServiceOptions = {}) {
    this.client = options.client || createDockerControlClient(undefined, undefined, options.actionTimeoutMs);
    this.composeRunner = options.composeRunner || createLocalComposeRunner(options.composeActionTimeoutMs ?? config.docker.composeActionTimeoutMs);
    this.policy = options.policy || {
      protectedProjects: config.docker.protectedProjects,
      protectedContainerNames: config.docker.protectedContainerNames,
    };
    this.stopTimeoutSeconds = Math.max(1, options.stopTimeoutSeconds ?? config.docker.stopTimeoutSeconds);
    this.groupActionConcurrency = Math.max(1, Math.floor(options.groupActionConcurrency ?? config.docker.groupActionConcurrency));
    this.persistState = options.persistState || defaultPersistState;
    this.now = options.now || (() => new Date());
  }

  start(id: string) {
    return this.executeContainer(id, 'start');
  }

  stop(id: string) {
    return this.executeContainer(id, 'stop');
  }

  restart(id: string) {
    return this.executeContainer(id, 'restart');
  }

  startGroup(id: string) {
    return this.executeGroup(id, 'start');
  }

  stopGroup(id: string) {
    return this.executeGroup(id, 'stop');
  }

  async restartGroup(id: string) {
    await this.requireComposeProjectOperation(id, 'restart');
    return this.executeGroup(id, 'restart');
  }

  async rebuildGroup(id: string) {
    return this.executeComposeGroupOperation(id, 'rebuild');
  }

  async redeployGroup(id: string) {
    return this.executeComposeGroupOperation(id, 'redeploy');
  }

  listComposeProjects() {
    return prisma.composeProjectOperation.findMany({ orderBy: { project: 'asc' } });
  }

  createComposeProject(data: ComposeProjectOperationInput) {
    return prisma.composeProjectOperation.create({ data: normalizeProjectInput(data) as any });
  }

  updateComposeProject(id: string, data: Partial<ComposeProjectOperationInput>) {
    const parsed = normalizeProjectInput(data, true);
    if (Object.keys(parsed).length === 0) throw new Error('at least one field is required to update');
    return prisma.composeProjectOperation.update({ where: { id }, data: parsed as any });
  }

  deleteComposeProject(id: string) {
    return prisma.composeProjectOperation.delete({ where: { id } });
  }

  private async executeContainer(id: string, action: ContainerAction): Promise<ContainerActionResponse> {
    const listed = await this.client.listContainers();
    const summary = selectCanonicalContainers(listed).find((item) => getContainerIdentity(item).id === id);
    if (!summary) throw new OrchestrationError(404, 'CONTAINER_NOT_FOUND', 'Container no longer exists');
    const identity = getContainerIdentity(summary);
    const groupId = identity.composeProject ? composeProjectGroupId(identity.composeProject) : null;
    const release = this.acquireContainerLock(id, groupId);
    try {
      return await this.executeContainerSummary(summary, action);
    } finally {
      release();
    }
  }

  private async executeGroup(id: string, action: ContainerAction): Promise<ContainerGroupActionResponse> {
    const containers = await this.listGroupContainers(id);
    if (!containers.length) throw new OrchestrationError(404, 'GROUP_NOT_FOUND', 'Docker Compose project no longer exists');

    const identities = containers.map((container) => getContainerIdentity(container));
    const project = identities[0].composeProject!;
    const initialSubjects = containers.map((container, index) => ({
      name: identities[index].name,
      state: container.State,
      health: null,
      composeProject: project,
    }));
    const initialPermission = describeContainerGroupOrchestration(initialSubjects, this.policy);
    if (initialPermission.protected) {
      throw new OrchestrationError(403, 'CONTAINER_PROTECTED', 'DyRGateway projects are protected from orchestration');
    }

    const release = this.acquireGroupLock(id, identities.map((identity) => identity.id));
    try {
      const results = await mapWithConcurrency(containers, this.groupActionConcurrency, async (container) => {
        try {
          const response = await this.executeContainerSummary(container, action);
          return this.toGroupResult(response);
        } catch (error) {
          return this.toFailedGroupResult(container, error);
        }
      });
      const finalSubjects = results.map((result) => ({
        name: result.name,
        state: result.state,
        health: result.health,
        composeProject: project,
      }));
      return {
        action,
        changed: results.some((result) => result.status === 'changed'),
        partial: results.some((result) => result.status === 'failed'),
        completedAt: this.now().toISOString(),
        group: {
          id,
          project,
          summary: summarizeContainerGroup(finalSubjects),
          orchestration: describeContainerGroupOrchestration(finalSubjects, this.policy),
        },
        results,
      };
    } finally {
      release();
    }
  }

  private async executeComposeGroupOperation(id: string, action: 'rebuild' | 'redeploy'): Promise<ContainerGroupActionResponse> {
    const operation = await this.requireComposeProjectOperation(id, action);
    const before = await this.listGroupContainers(id);
    const release = this.acquireGroupLock(id, before.map((container) => getContainerIdentity(container).id));
    try {
      await this.composeRunner.run(operation, action);
      const after = await this.listGroupContainers(id);
      const containers = after.length ? after : before;
      const results = containers.map((container) => {
        const identity = getContainerIdentity(container);
        return {
          containerId: identity.id,
          name: identity.name,
          instanceId: container.Id,
          previousState: before.find((item) => getContainerIdentity(item).id === identity.id)?.State || 'unknown',
          state: String(container.State || 'unknown').toLowerCase(),
          health: null,
          status: 'changed' as const,
          orchestration: describeContainerOrchestration({ name: identity.name, state: container.State, composeProject: identity.composeProject }, this.policy),
          error: null,
        };
      });
      const subjects = results.map((result) => ({ name: result.name, state: result.state, health: result.health, composeProject: operation.project }));
      return {
        action,
        changed: true,
        partial: false,
        completedAt: this.now().toISOString(),
        group: {
          id,
          project: operation.project,
          summary: summarizeContainerGroup(subjects),
          orchestration: describeContainerGroupOrchestration(subjects, this.policy),
        },
        results,
      };
    } finally {
      release();
    }
  }

  private async listGroupContainers(id: string) {
    const listed = await this.client.listContainers();
    return selectCanonicalContainers(listed)
      .filter((item) => {
        const project = getContainerIdentity(item).composeProject;
        return project ? composeProjectGroupId(project) === id : false;
      })
      .sort((left, right) => {
        const a = getContainerIdentity(left);
        const b = getContainerIdentity(right);
        return (a.composeService || '').localeCompare(b.composeService || '')
          || (a.composeContainerNumber || 0) - (b.composeContainerNumber || 0)
          || a.name.localeCompare(b.name);
      });
  }

  private async requireComposeProjectOperation(id: string, action: 'restart' | 'rebuild' | 'redeploy'): Promise<ComposeProjectOperationRecord> {
    const operations = await prisma.composeProjectOperation.findMany({ where: { active: true } });
    const operation = operations.find((item) => composeProjectGroupId(item.project) === id) as ComposeProjectOperationRecord | undefined;
    if (!operation) throw new OrchestrationError(403, 'COMPOSE_PROJECT_NOT_CONFIGURED', 'Compose project is not authorized for this operation');
    const permission = describeContainerGroupOrchestration([{ name: operation.project, state: 'running', composeProject: operation.project }], this.policy);
    if (permission.protected) throw new OrchestrationError(403, 'CONTAINER_PROTECTED', 'DyRGateway projects are protected from orchestration');
    if (action === 'restart' && !operation.canRestart) throw new OrchestrationError(403, 'COMPOSE_PROJECT_NOT_ALLOWED', 'Restart is not enabled for this Compose project');
    if (action === 'rebuild' && !operation.canRebuild) throw new OrchestrationError(403, 'COMPOSE_PROJECT_NOT_ALLOWED', 'Rebuild is not enabled for this Compose project');
    if (action === 'redeploy' && !operation.canRedeploy) throw new OrchestrationError(403, 'COMPOSE_PROJECT_NOT_ALLOWED', 'Redeploy is not enabled for this Compose project');
    return operation;
  }

  private acquireContainerLock(id: string, groupId: string | null) {
    if (this.containerLocks.has(id) || (groupId && this.groupLocks.has(groupId))) {
      throw new OrchestrationError(409, 'ACTION_IN_PROGRESS', 'Another action is already in progress for this container');
    }
    this.containerLocks.add(id);
    return () => this.containerLocks.delete(id);
  }

  private acquireGroupLock(groupId: string, containerIds: string[]) {
    if (this.groupLocks.has(groupId) || containerIds.some((id) => this.containerLocks.has(id))) {
      throw new OrchestrationError(409, 'ACTION_IN_PROGRESS', 'Another action is already in progress for this Docker Compose project');
    }
    this.groupLocks.add(groupId);
    containerIds.forEach((id) => this.containerLocks.add(id));
    return () => {
      this.groupLocks.delete(groupId);
      containerIds.forEach((id) => this.containerLocks.delete(id));
    };
  }

  private async executeContainerSummary(summary: DockerContainerSummary, action: ContainerAction): Promise<ContainerActionResponse> {
    const identity = getContainerIdentity(summary);
    const before = await this.client.inspectContainer(summary.Id);
    const previousState = String(before.State?.Status || summary.State || 'unknown').toLowerCase();
    const permission = describeContainerOrchestration({
      name: identity.name,
      composeProject: identity.composeProject,
      state: previousState,
    }, this.policy);
    if (permission.protected) {
      throw new OrchestrationError(403, 'CONTAINER_PROTECTED', 'DyRGateway containers are protected from orchestration');
    }

    let changed = false;
    if (action === 'start') {
      if (previousState === 'running') changed = false;
      else if (previousState === 'created' || previousState === 'exited') changed = await this.client.startContainer(summary.Id);
      else throw new OrchestrationError(409, 'UNSUPPORTED_CONTAINER_STATE', `Cannot start a container in state ${previousState}`);
    } else if (action === 'stop') {
      if (previousState === 'created' || previousState === 'exited') changed = false;
      else if (previousState === 'running') changed = await this.client.stopContainer(summary.Id, this.stopTimeoutSeconds);
      else throw new OrchestrationError(409, 'UNSUPPORTED_CONTAINER_STATE', `Cannot stop a container in state ${previousState}`);
    } else if (action === 'restart') {
      if (previousState !== 'running') throw new OrchestrationError(409, 'UNSUPPORTED_CONTAINER_STATE', `Cannot restart a container in state ${previousState}`);
      if (!this.client.restartContainer) throw new OrchestrationError(502, 'DOCKER_DAEMON_ERROR', 'Docker restart is unavailable');
      changed = await this.client.restartContainer(summary.Id, this.stopTimeoutSeconds);
    } else {
      throw new OrchestrationError(409, 'UNSUPPORTED_CONTAINER_STATE', `${action} is only supported for Compose projects`);
    }

    const after = changed ? await this.client.inspectContainer(summary.Id) : before;
    const state = String(after.State?.Status || previousState).toLowerCase();
    const health = typeof after.State?.Health?.Status === 'string' ? after.State.Health.Status : null;
    const instanceId = after.Id || summary.Id;
    const orchestration = describeContainerOrchestration({
      name: identity.name,
      composeProject: identity.composeProject,
      state,
    }, this.policy);

    await this.persistState(identity.id, {
      instanceId,
      state,
      health,
      instanceStartedAt: parseDockerDate(after.State?.StartedAt),
    }).catch(() => undefined);

    return {
      action,
      changed,
      completedAt: this.now().toISOString(),
      container: { id: identity.id, name: identity.name, instanceId, previousState, state, health },
      orchestration,
    };
  }

  private toGroupResult(response: ContainerActionResponse): ContainerGroupActionResult {
    return {
      containerId: response.container.id,
      name: response.container.name,
      instanceId: response.container.instanceId,
      previousState: response.container.previousState,
      state: response.container.state,
      health: response.container.health,
      status: response.changed ? 'changed' : 'unchanged',
      orchestration: response.orchestration,
      error: null,
    };
  }

  private toFailedGroupResult(summary: DockerContainerSummary, error: unknown): ContainerGroupActionResult {
    const identity = getContainerIdentity(summary);
    const state = String(summary.State || 'unknown').toLowerCase();
    const orchestration = describeContainerOrchestration({
      name: identity.name,
      composeProject: identity.composeProject,
      state,
    }, this.policy);
    const mapped = error instanceof OrchestrationError
      ? error
      : new OrchestrationError(502, 'DOCKER_DAEMON_ERROR', 'Docker daemon rejected the operation');
    return {
      containerId: identity.id,
      name: identity.name,
      instanceId: summary.Id,
      previousState: state,
      state,
      health: null,
      status: 'failed',
      orchestration,
      error: { code: mapped.code, message: mapped.message },
    };
  }
}