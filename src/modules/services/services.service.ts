import { PaginationOptions } from '../../shared/types';
import ServiceRepository from './service.respository';
import { CreateServiceDTO } from './services.types';

export default class ServicesService {

    private readonly repository: ServiceRepository;

    constructor(repository = new ServiceRepository()) {
        this.repository = repository;
    }

    async listServices(query: PaginationOptions) {
        const skip = query.skip ? Number(query.skip) : undefined;
        const take = query.take ? Number(query.take) : 10;

        return this.repository.listServices({ skip, take });
    }

    async findById(id: string) {
        if (!id) {
            throw new Error('id is required');
        }
        return this.repository.findById(id);
    }

    async deleteService(id: string) {
        if (!id) {
            throw new Error('id is required');
        }
        return this.repository.deleteService(id);
    }

    async createService(data: CreateServiceDTO) {
        return this.repository.createService(data);
    }
 }
