/**
 * The request and answer a `pages/api` handler is handed, written here so the
 * fixture needs no framework installed.
 */
export interface ApiRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface ApiResponse {
  statusCode: number;
  status(code: number): ApiResponse;
  json(body: unknown): void;
  send(body: string): void;
  setHeader(name: string, value: string): void;
}

export type ApiHandler = (request: ApiRequest, response: ApiResponse) => unknown | Promise<unknown>;
