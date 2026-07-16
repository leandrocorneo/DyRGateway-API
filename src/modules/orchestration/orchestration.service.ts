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
};

type PersistedState = {
  instanceId: string;
  state: string;
  health: string | null;
  instanceStartedAt: Date | null;
};

type ServiceOptions = {
  client?: DockerControlClient;
  policy?: ContainerOrchestrationPolicy;
  actionTimeoutMs?: number;
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

export default class OrchestrationService {
  private readonly client: DockerControlClient;
  private readonly policy: ContainerOrchestrationPolicy;
  private readonly stopTimeoutSeconds: number;
  private readonly groupActionConcurrency: number;
  private readonly persistState: (id: string, state: PersistedState) => Promise<void>;
  private readonly now: () => Date;
  private readonly containerLocks = new Set<string>();
  private readonly groupLocks = new Set<string>();

  constructor(options: ServiceOptions = {}) {
    this.client = options.client || createDockerControlClient(undefined, undefined, options.actionTimeoutMs);
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

  startGroup(id: string) {
    return this.executeGroup(id, 'start');
  }

  stopGroup(id: string) {
    return this.executeGroup(id, 'stop');
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
    const listed = await this.client.listContainers();
    const containers = selectCanonicalContainers(listed)
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
      if (previousState === 'running') {
        changed = false;
      } else if (previousState === 'created' || previousState === 'exited') {
        changed = await this.client.startContainer(summary.Id);
      } else {
        throw new OrchestrationError(409, 'UNSUPPORTED_CONTAINER_STATE', `Cannot start a container in state ${previousState}`);
      }
    } else if (previousState === 'created' || previousState === 'exited') {
      changed = false;
    } else if (previousState === 'running') {
      changed = await this.client.stopContainer(summary.Id, this.stopTimeoutSeconds);
    } else {
      throw new OrchestrationError(409, 'UNSUPPORTED_CONTAINER_STATE', `Cannot stop a container in state ${previousState}`);
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
