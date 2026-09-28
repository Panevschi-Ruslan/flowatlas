/**
 * The client the browser half writes itself, wrapping the browser's own.
 *
 * The same shape as `react-local-client`'s recognised class, on purpose: what
 * this fixture is about is which reader opens the directory, not how a request
 * is recognised once one has.
 */
class ApiClient {
  private send = async (path: string, method: string, body?: object): Promise<unknown> => {
    const answer = await fetch(path, { method, body: JSON.stringify(body) });
    return answer.json();
  };

  get = (path: string): Promise<unknown> => this.send(path, 'GET');

  post = (path: string, body?: object): Promise<unknown> => this.send(path, 'POST', body);
}

export const api = new ApiClient();
