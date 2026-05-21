export type CreateServiceDTO = {
  applicationId: string;
  type: string;
  path: string;
  targetHost: string;
  targetPort: number;
  active?: boolean;
};
