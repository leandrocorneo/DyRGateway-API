import { prisma } from '../../database/prisma';
import { PaginationOptions } from '../../shared/types';
import { CreateApplicationDTO } from './applications.types';

export default class ApplicationRepository {
  async listApplications(paginationOpts?: PaginationOptions) {
    return prisma.application.findMany({
      orderBy: { createdAt: 'desc' },
      skip: paginationOpts?.skip,
      take: paginationOpts?.take,
    });
  }

  async findById(id: string) {
    return prisma.application.findUnique({
      where: { id },
    });
  }

  async createApplication(data: CreateApplicationDTO) {
    return prisma.application.create({
      data: {
        name: data.name,
        slug: data.slug,
        active: data.active ?? true,
      },
    });
  }

  async deleteById(id: string) {
    return prisma.application.delete({
      where: { id },
    });
  }
}
