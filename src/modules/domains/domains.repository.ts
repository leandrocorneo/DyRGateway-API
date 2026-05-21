import { prisma } from '../../database/prisma';
import { PaginationOptions } from '../../shared/types';
import { UpdateDomainDTO } from './domains.types';

export default class DomainRepository {
    async listDomains(paginationOpts?: PaginationOptions) {
        return prisma.domain.findMany({
            orderBy: { createdAt: 'desc' },
            skip: paginationOpts?.skip,
            take: paginationOpts?.take,
        });
    }

    async findByHost(host: string) {
        return prisma.domain.findUnique({
            where: { host },
        });
    }

    async createDomain(host: string, applicationId: string) {
        return prisma.domain.create({
            data: { host, applicationId },
        });
    }

    async updateById(id: string, data: UpdateDomainDTO) {
        return prisma.domain.update({
            where: { id },
            data,
        });
    }

    async deleteById(id: string) {
        return prisma.domain.delete({
            where: { id },
        });
    }
}
