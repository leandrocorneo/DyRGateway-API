import assert from 'node:assert/strict';
import test from 'node:test';
import ServiceTypesRepository from '../../../src/modules/service-types/service-types.repository';
import ServiceTypesService from '../../../src/modules/service-types/service-types.service';

test('listServiceTypes returns the repository catalog', async () => {
  const expected = [
    { id: '1', description: 'http' },
    { id: '2', description: 'websocket' },
  ];
  const repository = {
    listServiceTypes: async () => expected,
  } as ServiceTypesRepository;

  const service = new ServiceTypesService(repository);

  assert.deepEqual(await service.listServiceTypes(), expected);
});
