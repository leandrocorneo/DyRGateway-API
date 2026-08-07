import { prisma } from '../../database/prisma';

export default class ServiceTypesRepository {
  async listServiceTypes() {
    return prisma.serviceType.findMany({
      select: {
        id: true,
        description: true,
      },
      orderBy: {
        description: 'asc',
      },
    });
  }
}
