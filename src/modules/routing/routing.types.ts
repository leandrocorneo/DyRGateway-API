export type RoutingPreferenceParams = { serviceId: string };

export type UpdateRoutingPreferenceDTO = {
  containerId: string | null;
};

export type RoutingTlsStatus = 'valid' | 'invalid' | 'expired' | 'unavailable' | 'not-applicable';

export class RoutingError extends Error {
  constructor(
    public readonly statusCode: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}