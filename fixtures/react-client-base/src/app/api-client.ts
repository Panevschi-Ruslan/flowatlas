/**
 * The client every request in the browser half is written through.
 *
 * One class, one base, and the base is the whole of this fixture. It is set in
 * the constructor with a default beside it — `options.baseUrl || '/api'` — which
 * is how this shape is nearly always written: the default is what every instance
 * nobody passed options to actually has, and the one instance below passes none.
 *
 * No call site writes `/api`. A reader that records the path as written produces
 * `/documents.info`, which is an address this repository does not serve; it
 * matched a route only for as long as the route was also missing the segment,
 * which is exactly the way two correct fixes cancelled (R114).
 */
type Options = {
  baseUrl?: string;
};

class ApiClient {
  baseUrl: string;

  constructor(options: Options = {}) {
    this.baseUrl = options.baseUrl || '/api';
  }

  /** The transport, and the only place the base and the path are put together. */
  private send = async (path: string, method: string, body?: object): Promise<unknown> => {
    const answer = await fetch(this.baseUrl + path, { method, body: JSON.stringify(body) });
    return answer.json();
  };

  get = (path: string): Promise<unknown> => this.send(path, 'GET');

  post = (path: string, body?: object): Promise<unknown> => this.send(path, 'POST', body);
}

export const client = new ApiClient();
