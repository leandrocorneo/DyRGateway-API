import ServiceTypesRepository from './service-types.repository';

export default class ServiceTypesService {
  constructor(private readonly repository = new ServiceTypesRepository()) {}

  async listServiceTypes() {
    return this.repository.listServiceTypes();
  }
}
