import test from 'node:test';
import assert from 'node:assert/strict';
import { describeContainerOrchestration } from '../../../src/modules/orchestration/orchestration.types';

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
    reason: 'already-running',
  });
  assert.deepEqual(exited, {
    protected: false,
    canStart: true,
    canStop: false,
    reason: 'already-stopped',
  });
  assert.deepEqual(paused, {
    protected: false,
    canStart: false,
    canStop: false,
    reason: 'unsupported-state',
  });
});
