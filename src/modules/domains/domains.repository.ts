import { prisma } from '../../database/prisma';
import { PaginationOptions } from '../../shared/types';

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

    async deleteById(id: string) {
        return prisma.domain.delete({
            where: { id },
        });
    }
}