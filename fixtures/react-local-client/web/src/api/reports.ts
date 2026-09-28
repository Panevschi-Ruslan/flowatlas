/**
 * A client whose transport is one module away, which recognition cannot follow.
 *
 * `send` is an ordinary exported function in another file. Following a verb into
 * it would mean following calls out of the class and through the module graph,
 * which is a different and much larger question than reading one declaration, so
 * this reader does not: it says instead that `ReportsClient` is called by an HTTP
 * verb and that it could not prove the verb is a request. The row names the class
 * and says which line of configuration would settle it.
 */
import { send } from './transport.js';

class ReportsClient {
  get = (path: string): Promise<unknown> => send(path, 'GET');

  post = (path: string, body?: object): Promise<unknown> => send(path, 'POST', body);
}

export const reports = new ReportsClient();
