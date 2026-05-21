import DomainRepository from './domains.repository';

export default class DomainService {
	private repository: DomainRepository;

	constructor(repository = new DomainRepository()) {
		this.repository = repository;
	}

	async listDomains(query: paginationOptions) {
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

	async createDomain(host: string, applicationId: string) {
		if (!host || !applicationId) {
			throw new Error('host and applicationId are required');
		}

		return this.repository.createDomain(host, applicationId);
	}

	async deleteDomain(id: string) {
		if (!id) {
			throw new Error('id is required');
		}

		return this.repository.deleteById(id);
	}
}
