import { PaginationOptions } from '../../shared/types';
import ApplicationRepository from './applications.repository';
import { CreateApplicationDTO, UpdateApplicationDTO } from './applications.types';

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
    const name = data.name?.trim();
    if (!name) {
      throw new Error('name is required');
    }

    const slug = data.slug ? this.slugify(data.slug) : this.slugify(name);
    return this.repository.createApplication({
      ...data,
      name,
      slug,
    });
  }

  async updateApplication(id: string, data: UpdateApplicationDTO) {
    if (!id) {
      throw new Error('id is required');
    }

    const updateData: UpdateApplicationDTO = {};

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new Error('name cannot be empty');
      }
      updateData.name = name;
    }

    if (data.slug !== undefined) {
      const slug = this.slugify(data.slug);
      if (!slug) {
        throw new Error('slug is invalid');
      }
      updateData.slug = slug;
    }

    if (data.active !== undefined) {
      updateData.active = data.active;
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('at least one field is required to update');
    }

    return this.repository.updateById(id, updateData);
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
