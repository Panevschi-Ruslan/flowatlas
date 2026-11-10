import { recordVisit } from './audit';

export type ApiRequest = { method?: string; url?: string; headers: Record<string, string | undefined> };
export type ApiResponse = { status(code: number): ApiResponse; json(body: unknown): void; setHeader(name: string, value: string): void };
export type ApiHandler = (request: ApiRequest, response: ApiResponse) => Promise<void>;

/**
 * The wrapper every route file of the shop ends with: it records the visit and
 * stamps the answer, then hands the request on. Its body runs on every request.
 */
export const withAudit = (handler: ApiHandler): ApiHandler => {
  return async (request, response) => {
    await recordVisit(request.url ?? '');
    response.setHeader('x-audited', 'yes');
    await handler(request, response);
  };
};
