import { prisma } from '../../database/prisma';
import { PaginationOptions } from '../../shared/types';
import { CreateServiceDTO, UpdateServiceDTO } from './services.types';

export default class ServiceRepository {
    async listServices(paginationOpts?: PaginationOptions) {
        return prisma.service.findMany({
            orderBy: { createdAt: 'desc' },
            skip: paginationOpts?.skip,
            take: paginationOpts?.take,
        });
    }

    async findById(id: string) {
        return prisma.service.findUnique({
            where: { id },
        });
    }

    async createService(data: CreateServiceDTO) {
        const { applicationId, serviceTypeId, path, targetHost, targetPort, active } = data;
        return prisma.service.create({
            data: {
                applicationId,
                serviceTypeId,
                path,
                targetHost,
                targetPort,
                active,
            }
        });
    }

    async updateService(id: string, data: UpdateServiceDTO) {
        return prisma.service.update({
            where: { id },
            data,
        });
    }

    async deleteService(id: string) {
        return prisma.service.delete({
            where: { id },
        });
    }
}
