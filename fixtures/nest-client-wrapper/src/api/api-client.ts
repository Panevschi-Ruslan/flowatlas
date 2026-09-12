/**
 * A client every service shares.
 *
 * The address is settled once, where the client is built, and the path only
 * exists at the call sites. Nothing here names a route, so a reader that stops
 * at the `fetch` below learns nothing at all about who calls what.
 */
export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private getFetcher(): typeof fetch {
    return fetch;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.getFetcher()(url, init);
    return JSON.parse(await res.text()) as T;
  }
}
