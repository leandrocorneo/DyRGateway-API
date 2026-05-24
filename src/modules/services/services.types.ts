export type CreateServiceDTO = {
  applicationId: string;
  serviceTypeId: string;
  path: string;
  targetHost: string;
  targetPort: number;
  active?: boolean;
};

export type UpdateServiceDTO = {
  applicationId?: string;
  serviceTypeId?: string;
  path?: string;
  targetHost?: string;
  targetPort?: number;
  active?: boolean;
};
