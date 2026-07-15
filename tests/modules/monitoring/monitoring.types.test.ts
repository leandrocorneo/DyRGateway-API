import test from 'node:test';
import assert from 'node:assert/strict';
import { MonitoringQueryError, parseContainerCatalogQuery, parseContainerHistoryQuery } from '../../../src/modules/monitoring/monitoring.types';

test('applies catalog and history pagination defaults', () => {
  assert.deepEqual(parseContainerCatalogQuery({}), { state: 'running', project: undefined, search: undefined, skip: 0, take: 25 });
  assert.deepEqual(parseContainerHistoryQuery({}), { range: undefined, skip: 0, take: 120 });
});

test('validates state, pagination and search limits', () => {
  assert.throws(() => parseContainerCatalogQuery({ state: 'removed' }), MonitoringQueryError);
  assert.throws(() => parseContainerCatalogQuery({ container: 'api' } as any), MonitoringQueryError);
  assert.throws(() => parseContainerCatalogQuery({ take: '101' }), MonitoringQueryError);
  assert.throws(() => parseContainerHistoryQuery({ take: '241' }), MonitoringQueryError);
  assert.throws(() => parseContainerCatalogQuery({ skip: '-1' }), MonitoringQueryError);
  assert.throws(() => parseContainerCatalogQuery({ search: 'x'.repeat(101) }), MonitoringQueryError);
});
