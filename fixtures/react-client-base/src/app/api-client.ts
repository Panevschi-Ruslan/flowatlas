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
 *
 * A call may write a base of its own, and this client takes one the way every
 * client of this shape does: an options object after the body, whose `baseUrl`
 * the transport uses in place of the field. The field is still the base of every
 * call that says nothing (R128).
 */
type Options = {
  baseUrl?: string;
};

/**
 * What one call may say for itself.
 *
 * The base, and only the base: a call that spells one means an address under
 * that rather than under the client's, which is the same fact the class holds
 * written in a second place (R128).
 */
type CallOptions = {
  baseUrl?: string;
};

class ApiClient {
  baseUrl: string;

  constructor(options: Options = {}) {
    this.baseUrl = options.baseUrl || '/api';
  }

  /** The transport, and the only place the base and the path are put together. */
  private send = async (
    path: string,
    method: string,
    body?: object,
    base?: string,
  ): Promise<unknown> => {
    const answer = await fetch((base ?? this.baseUrl) + path, {
      method,
      body: JSON.stringify(body),
    });
    return answer.json();
  };

  get = (path: string, options?: CallOptions): Promise<unknown> =>
    this.send(path, 'GET', undefined, options?.baseUrl);

  post = (path: string, body?: object, options?: CallOptions): Promise<unknown> =>
    this.send(path, 'POST', body, options?.baseUrl);
}

export const client = new ApiClient();
