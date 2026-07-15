export type ContainerOrchestrationReason =
  | 'protected'
  | 'already-running'
  | 'already-stopped'
  | 'unsupported-state'
  | null;

export type ContainerOrchestration = {
  protected: boolean;
  canStart: boolean;
  canStop: boolean;
  reason: ContainerOrchestrationReason;
};

export type ContainerOrchestrationSubject = {
  name: string;
  state: string;
  composeProject?: string | null;
};

export type ContainerOrchestrationPolicy = {
  protectedProjects: readonly string[];
  protectedContainerNames: readonly string[];
};

const normalizedSet = (values: readonly string[]) =>
  new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));

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
    return { protected: true, canStart: false, canStop: false, reason: 'protected' };
  }

  const state = container.state.toLowerCase();
  if (state === 'running') {
    return { protected: false, canStart: false, canStop: true, reason: 'already-running' };
  }
  if (state === 'created' || state === 'exited') {
    return { protected: false, canStart: true, canStop: false, reason: 'already-stopped' };
  }
  return { protected: false, canStart: false, canStop: false, reason: 'unsupported-state' };
};

export type ContainerAction = 'start' | 'stop';

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
