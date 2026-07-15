export type ContainerCatalogState = 'running' | 'stopped' | 'all';

export type ContainerCatalogQuery = {
  state?: string;
  project?: string;
  search?: string;
  skip?: string | number;
  take?: string | number;
};

export type ContainerHistoryQuery = {
  range?: string;
  skip?: string | number;
  take?: string | number;
};

export class MonitoringQueryError extends Error {}

const parseInteger = (value: string | number | undefined, fallback: number, field: string, maximum: number) => {
  if (value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || (field === 'take' && (parsed < 1 || parsed > maximum))) {
    throw new MonitoringQueryError(`${field} must be an integer between ${field === 'take' ? 1 : 0} and ${maximum}`);
  }
  return parsed;
};

const parseText = (value: string | undefined, field: string) => {
  if (value === undefined) return undefined;
  const parsed = value.trim();
  if (!parsed) return undefined;
  if (parsed.length > 100) throw new MonitoringQueryError(`${field} must contain at most 100 characters`);
  return parsed;
};

export const parseContainerCatalogQuery = (query: ContainerCatalogQuery) => {
  if ('container' in query) throw new MonitoringQueryError('container parameter is no longer supported');
  const state = (query.state || 'running') as ContainerCatalogState;
  if (!['running', 'stopped', 'all'].includes(state)) {
    throw new MonitoringQueryError('state must be running, stopped or all');
  }
  return {
    state,
    project: parseText(query.project, 'project'),
    search: parseText(query.search, 'search'),
    skip: parseInteger(query.skip, 0, 'skip', Number.MAX_SAFE_INTEGER),
    take: parseInteger(query.take, 25, 'take', 100),
  };
};

export const parseContainerHistoryQuery = (query: ContainerHistoryQuery) => ({
  range: query.range,
  skip: parseInteger(query.skip, 0, 'skip', Number.MAX_SAFE_INTEGER),
  take: parseInteger(query.take, 120, 'take', 240),
});
