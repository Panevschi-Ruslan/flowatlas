import { API_URL } from './constants';
import { getSdk } from './generated/graphql';

export interface CallOptions {
  request?: Request;
}

async function postOperation<Response>(body: { query: string; variables?: unknown; headers?: Headers }): Promise<{ data: Response; errors?: unknown[] }> {
  const headers = new Headers(body.headers);
  headers.append('Content-Type', 'application/json');
  return fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  }).then((res) => res.json());
}

function requester<R, V>(doc: unknown, variables?: V, options?: CallOptions): Promise<R> {
  return postOperation<R>({ query: String(doc), variables, ...options }).then((response) => response.data);
}

const generated = getSdk<CallOptions, unknown>(requester);

export const api: typeof generated = generated as any;
