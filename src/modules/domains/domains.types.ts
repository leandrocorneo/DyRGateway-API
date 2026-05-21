export type CreateDomainDTO = {
	host: string;
	applicationId: string;
};

export type UpdateDomainDTO = {
	host?: string;
	applicationId?: string;
};

export type DomainByHostParams = {
	host: string;
};

export type DomainByIdParams = {
	id: string;
};
