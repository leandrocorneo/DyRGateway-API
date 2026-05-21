import { PaginationOptions } from '../../shared/types';
import DomainRepository from './domains.repository';
import { CreateDomainDTO, UpdateDomainDTO } from './domains.types';

export default class DomainService {
	private repository: DomainRepository;

	constructor(repository = new DomainRepository()) {
		this.repository = repository;
	}

	async listDomains(query: PaginationOptions) {
        const skip = query.skip ? Number(query.skip) : undefined;
        const take = query.take ? Number(query.take) : 10;

        return this.repository.listDomains({
            skip,
            take,
        });
    }

	async findByHost(host: string) {
		return this.repository.findByHost(host);
	}

	async createDomain(data: CreateDomainDTO) {
		const { host, applicationId } = data;
		if (!host || !applicationId) {
			throw new Error('host and applicationId are required');
		}

		return this.repository.createDomain(host.trim(), applicationId.trim());
	}

	async updateDomain(id: string, data: UpdateDomainDTO) {
		if (!id) {
			throw new Error('id is required');
		}

		const updateData: UpdateDomainDTO = {};

		if (data.host !== undefined) {
			const host = data.host.trim();
			if (!host) {
				throw new Error('host cannot be empty');
			}
			updateData.host = host;
		}

		if (data.applicationId !== undefined) {
			const applicationId = data.applicationId.trim();
			if (!applicationId) {
				throw new Error('applicationId cannot be empty');
			}
			updateData.applicationId = applicationId;
		}

		if (Object.keys(updateData).length === 0) {
			throw new Error('at least one field is required to update');
		}

		return this.repository.updateById(id, updateData);
	}

	async deleteDomain(id: string) {
		if (!id) {
			throw new Error('id is required');
		}

		return this.repository.deleteById(id);
	}
}
