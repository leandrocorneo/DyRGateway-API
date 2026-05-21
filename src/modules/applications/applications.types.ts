export type CreateApplicationDTO = {
  name: string;
  slug: string;
  active?: boolean;
};

export type UpdateApplicationDTO = {
  name?: string;
  slug?: string;
  active?: boolean;
};

export type ApplicationByIdParams = {
  id: string;
};
