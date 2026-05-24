export type ResolvedApplication = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
};

export type ResolvedService = {
  id: string;
  applicationId: string;
  serviceTypeId: string;
  serviceType: {
    id: string;
    description: string;
  };
  path: string;
  targetHost: string;
  targetPort: number;
  active: boolean;
};

export type ResolvedHost = {
  host: string;
  domainId: string;
  application: ResolvedApplication;
  services: ResolvedService[];
} | null;

export type ResolvedTarget = {
  host: string;
  path: string;
  domainId: string;
  application: ResolvedApplication;
  service: ResolvedService;
} | null;
