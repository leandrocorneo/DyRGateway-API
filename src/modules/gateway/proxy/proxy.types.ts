import { IncomingMessage, ServerResponse } from 'http';
import { ResolvedTarget } from '../resolver/resolver.types';

export type ProxyHttpRequest = {
  request: IncomingMessage;
  response: ServerResponse;
  target: NonNullable<ResolvedTarget>;
  body?: Buffer;
};
