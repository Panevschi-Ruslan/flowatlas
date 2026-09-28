/**
 * The same unfollowable shape, declared in the configuration instead.
 *
 * `BillingClient` is named under `adapters.frontend.localClientClasses`, so no
 * question is asked about how its verbs reach the network — that is what naming
 * it is for, and it is why the escape hatch exists: recognition is better when it
 * works and worse when it guesses, and declaring always works. Its requests are
 * read and carry `localClient: "declared"`, where `ApiClient`'s carry
 * `"recognised"`, so a reader of the graph can tell which of the two happened.
 */
import { send } from './transport.js';

export class BillingClient {
  get = (path: string): Promise<unknown> => send(path, 'GET');

  put = (path: string, body?: object): Promise<unknown> => send(path, 'PUT', body);
}

export const billing = new BillingClient();
