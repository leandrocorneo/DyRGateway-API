import { containerTargetId } from '../../monitoring/core/container';

export type ContainerOrchestrationReason =
  | 'protected'
  | 'already-running'
  | 'already-stopped'
  | 'unsupported-state'
  | 'operation-not-configured'
  | null;

export type ContainerOrchestration = {
  protected: boolean;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  canRebuild: boolean;
  canRedeploy: boolean;
  reason: ContainerOrchestrationReason;
};

const orchestration = (value: Omit<ContainerOrchestration, 'canRestart' | 'canRebuild' | 'canRedeploy'> & Partial<Pick<ContainerOrchestration, 'canRestart' | 'canRebuild' | 'canRedeploy'>>): ContainerOrchestration => ({
  canRestart: false,
  canRebuild: false,
  canRedeploy: false,
  ...value,
});

export type ContainerOrchestrationSubject = {
  name: string;
  state: string;
  health?: string | null;
  composeProject?: string | null;
};

export type ContainerOrchestrationPolicy = {
  protectedProjects: readonly string[];
  protectedContainerNames: readonly string[];
};

export type ContainerGroupSummary = {
  total: number;
  running: number;
  stopped: number;
  healthy: number;
  unhealthy: number;
  unknown: number;
};

const normalizedSet = (values: readonly string[]) =>
  new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));

export const composeProjectGroupId = (project: string) =>
  containerTargetId('compose-project:' + project.trim().toLowerCase());

export const describeContainerOrchestration = (
  container: ContainerOrchestrationSubject,
  policy: ContainerOrchestrationPolicy,
): ContainerOrchestration => {
  const protectedProjects = normalizedSet(policy.protectedProjects);
  const protectedNames = normalizedSet(policy.protectedContainerNames);
  const protectedContainer = Boolean(
    (container.composeProject && protectedProjects.has(container.composeProject.toLowerCase()))
    || protectedNames.has(container.name.toLowerCase()),
  );

  if (protectedContainer) {
    return orchestration({ protected: true, canStart: false, canStop: false, reason: 'protected' });
  }

  const state = container.state.toLowerCase();
  if (state === 'running') {
    return orchestration({ protected: false, canStart: false, canStop: true, canRestart: true, reason: 'already-running' });
  }
  if (state === 'created' || state === 'exited') {
    return orchestration({ protected: false, canStart: true, canStop: false, reason: 'already-stopped' });
  }
  return orchestration({ protected: false, canStart: false, canStop: false, reason: 'unsupported-state' });
};

export const summarizeContainerGroup = (containers: ContainerOrchestrationSubject[]): ContainerGroupSummary => {
  const running = containers.filter((container) => container.state.toLowerCase() === 'running').length;
  const healthy = containers.filter((container) => container.state.toLowerCase() === 'running' && container.health === 'healthy').length;
  const unhealthy = containers.filter((container) => container.state.toLowerCase() === 'running' && container.health === 'unhealthy').length;
  return {
    total: containers.length,
    running,
    stopped: containers.length - running,
    healthy,
    unhealthy,
    unknown: Math.max(0, running - healthy - unhealthy),
  };
};

export const describeContainerGroupOrchestration = (
  containers: ContainerOrchestrationSubject[],
  policy: ContainerOrchestrationPolicy,
): ContainerOrchestration => {
  const permissions = containers.map((container) => describeContainerOrchestration(container, policy));
  if (permissions.some((permission) => permission.protected)) {
    return orchestration({ protected: true, canStart: false, canStop: false, reason: 'protected' });
  }
  const canStart = permissions.some((permission) => permission.canStart);
  const canStop = permissions.some((permission) => permission.canStop);
  const canRestart = permissions.some((permission) => permission.canRestart);
  const reason: ContainerOrchestrationReason = canStart && canStop
    ? null
    : canStop
      ? 'already-running'
      : canStart
        ? 'already-stopped'
        : 'unsupported-state';
  return orchestration({ protected: false, canStart, canStop, canRestart, reason });
};

export type ContainerAction = 'start' | 'stop' | 'restart' | 'rebuild' | 'redeploy';

export type ContainerActionResponse = {
  action: ContainerAction;
  changed: boolean;
  completedAt: string;
  container: {
    id: string;
    name: string;
    instanceId: string;
    previousState: string;
    state: string;
    health: string | null;
  };
  orchestration: ContainerOrchestration;
};

export type ContainerGroupActionResult = {
  containerId: string;
  name: string;
  instanceId: string;
  previousState: string;
  state: string;
  health: string | null;
  status: 'changed' | 'unchanged' | 'failed';
  orchestration: ContainerOrchestration;
  error: { code: string; message: string } | null;
};

export type ContainerGroupActionResponse = {
  action: ContainerAction;
  changed: boolean;
  partial: boolean;
  completedAt: string;
  group: {
    id: string;
    project: string;
    summary: ContainerGroupSummary;
    orchestration: ContainerOrchestration;
  };
  results: ContainerGroupActionResult[];
};
