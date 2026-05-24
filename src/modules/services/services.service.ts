import { PaginationOptions } from '../../shared/types';
import ServiceRepository from './service.respository';
import { CreateServiceDTO, UpdateServiceDTO } from './services.types';

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
        const applicationId = data.applicationId?.trim();
        const serviceTypeId = data.serviceTypeId?.trim();
        const targetHost = data.targetHost?.trim();

        if (!applicationId || !serviceTypeId || !data.path || !targetHost) {
            throw new Error('applicationId, serviceTypeId, path and targetHost are required');
        }

        if (!Number.isInteger(data.targetPort) || data.targetPort <= 0) {
            throw new Error('targetPort must be a positive integer');
        }

        return this.repository.createService({
            ...data,
            applicationId,
            serviceTypeId,
            path: this.normalizePath(data.path),
            targetHost,
        });
    }

    async updateService(id: string, data: UpdateServiceDTO) {
        if (!id) {
            throw new Error('id is required');
        }

        const updateData: UpdateServiceDTO = {};

        if (data.applicationId !== undefined) {
            const applicationId = data.applicationId.trim();
            if (!applicationId) {
                throw new Error('applicationId cannot be empty');
            }
            updateData.applicationId = applicationId;
        }

        if (data.serviceTypeId !== undefined) {
            const serviceTypeId = data.serviceTypeId.trim();
            if (!serviceTypeId) {
                throw new Error('serviceTypeId cannot be empty');
            }
            updateData.serviceTypeId = serviceTypeId;
        }

        if (data.path !== undefined) {
            updateData.path = this.normalizePath(data.path);
        }

        if (data.targetHost !== undefined) {
            const targetHost = data.targetHost.trim();
            if (!targetHost) {
                throw new Error('targetHost cannot be empty');
            }
            updateData.targetHost = targetHost;
        }

        if (data.targetPort !== undefined) {
            if (!Number.isInteger(data.targetPort) || data.targetPort <= 0) {
                throw new Error('targetPort must be a positive integer');
            }
            updateData.targetPort = data.targetPort;
        }

        if (data.active !== undefined) {
            updateData.active = data.active;
        }

        if (Object.keys(updateData).length === 0) {
            throw new Error('at least one field is required to update');
        }

        return this.repository.updateService(id, updateData);
    }

    private normalizePath(path: string) {
        const trimmedPath = path.trim();
        if (!trimmedPath) {
            throw new Error('path cannot be empty');
        }

        return trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
    }
 }
