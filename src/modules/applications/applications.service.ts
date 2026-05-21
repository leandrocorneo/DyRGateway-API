import { PaginationOptions } from '../../shared/types';
import ApplicationRepository from './applications.repository';
import { CreateApplicationDTO } from './applications.types';

export default class ApplicationsService {
  private readonly repository: ApplicationRepository;

  constructor(repository = new ApplicationRepository()) {
    this.repository = repository;
  }

  async listApplications(query: PaginationOptions) {
    const skip = query.skip ? Number(query.skip) : undefined;
    const take = query.take ? Number(query.take) : 10;

    return this.repository.listApplications({ skip, take });
  }

  async findById(id: string) {
    if (!id) {
      throw new Error('id is required');
    }
    return this.repository.findById(id);
  }

  async createApplication(data: CreateApplicationDTO) {
    if (!data.name) {
      throw new Error('name is required');
    }

    const slug = data.slug || this.slugify(data.name);
    return this.repository.createApplication({
      ...data,
      slug,
    });
  }

  async deleteApplication(id: string) {
    if (!id) {
      throw new Error('id is required');
    }
    return this.repository.deleteById(id);
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
}
