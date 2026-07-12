import { IncomingMessage, ServerResponse } from 'http';
import { Duplex } from 'stream';
import { ResolvedTarget } from '../resolver/resolver.types';

export type ProxyHttpRequest = {
  request: IncomingMessage;
  response: ServerResponse;
  target: NonNullable<ResolvedTarget>;
  body?: Buffer;
  onProxyResponse?: (statusCode: number) => void;
};

export type ProxyWebSocketRequest = {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  target: NonNullable<ResolvedTarget>;
};
