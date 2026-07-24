import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeProjectGroupId,
  describeContainerGroupOrchestration,
  describeContainerOrchestration,
  summarizeContainerGroup,
} from '../../../src/modules/orchestration/orchestration.types';

const policy = {
  protectedProjects: ['dyrgatewayapi', 'dyrgateway'],
  protectedContainerNames: ['DyRGateway', 'next-app'],
};

test('protects DyRGateway Compose projects case-insensitively', () => {
  const result = describeContainerOrchestration({
    name: 'renamed-api',
    state: 'running',
    composeProject: 'DyRGatewayAPI',
  }, policy);

  assert.deepEqual(result, {
    protected: true,
    canStart: false,
    canStop: false,
    canRestart: false,
    canRebuild: false,
    canRedeploy: false,
    reason: 'protected',
  });
});

test('protects fallback container names outside Compose', () => {
  const result = describeContainerOrchestration({
    name: 'NEXT-APP',
    state: 'exited',
    composeProject: null,
  }, policy);

  assert.equal(result.protected, true);
  assert.equal(result.reason, 'protected');
});

test('exposes only the action supported by the current Docker state', () => {
  const running = describeContainerOrchestration({ name: 'external', state: 'running' }, policy);
  const exited = describeContainerOrchestration({ name: 'external', state: 'exited' }, policy);
  const paused = describeContainerOrchestration({ name: 'external', state: 'paused' }, policy);

  assert.deepEqual(running, {
    protected: false,
    canStart: false,
    canStop: true,
    canRestart: true,
    canRebuild: false,
    canRedeploy: false,
    reason: 'already-running',
  });
  assert.deepEqual(exited, {
    protected: false,
    canStart: true,
    canStop: false,
    canRestart: false,
    canRebuild: false,
    canRedeploy: false,
    reason: 'already-stopped',
  });
  assert.deepEqual(paused, {
    protected: false,
    canStart: false,
    canStop: false,
    canRestart: false,
    canRebuild: false,
    canRedeploy: false,
    reason: 'unsupported-state',
  });
});

test('keeps Compose group identity stable across project casing', () => {
  assert.equal(composeProjectGroupId('External-Project'), composeProjectGroupId('external-project'));
});

test('summarizes partially running projects and exposes both actions', () => {
  const containers = [
    { name: 'app', state: 'running', health: 'healthy', composeProject: 'external' },
    { name: 'worker', state: 'exited', health: null, composeProject: 'external' },
  ];
  assert.deepEqual(summarizeContainerGroup(containers), {
    total: 2, running: 1, stopped: 1, healthy: 1, unhealthy: 0, unknown: 0,
  });
  assert.deepEqual(describeContainerGroupOrchestration(containers, policy), {
    protected: false, canStart: true, canStop: true, canRestart: true, canRebuild: false, canRedeploy: false, reason: null,
  });
});

test('protects a group when any child uses a protected fallback name', () => {
  const result = describeContainerGroupOrchestration([
    { name: 'external', state: 'running', composeProject: 'other' },
    { name: 'next-app', state: 'running', composeProject: 'other' },
  ], policy);
  assert.equal(result.protected, true);
  assert.equal(result.canStart, false);
  assert.equal(result.canStop, false);
});
