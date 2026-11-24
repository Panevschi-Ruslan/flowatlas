import { requestFactsPassOf, type ExtractorPass, type RequestClient, type RequestFactsHost } from '@flowatlas/core';

/**
 * The HTTP clients whose own behaviour the request facts depend on, as
 * descriptions (P394, the facts themselves P388).
 *
 * Reading what a request says about itself is one function in the core: the
 * statuses the code around it branches on, the credentials, headers and body
 * its call spells out. What a client does without the call saying so is a
 * fact about that client, and sits here: which ones send an object body as
 * JSON and take it before their options, and which settings reach every
 * request they send. Each is found by the mark its reader writes on the
 * requests it draws, so a client nobody describes is read by the call alone.
 */

/**
 * Angular's `HttpClient` (`@angular/common/http`, the `package` its reader
 * writes on each request): a body goes as JSON and comes before the options,
 * `HttpParams` goes as a form, and an interceptor that clones each request
 * `withCredentials` or with headers set reaches every request.
 */
const ANGULAR_HTTP_CLIENT: RequestClient = {
  drawnWith: { key: 'package', value: '@angular/common/http' },
  jsonByDefault: true,
  bodiesAsIs: ['HttpParams'],
  every: { marks: /withCredentials|setHeaders/, perRequest: 'clone' },
};

/**
 * axios: a body goes as JSON and comes before the config; its defaults
 * (`axios.defaults.withCredentials = true`,
 * `axios.defaults.headers.common['X-Tenant'] = …`) and an instance made with
 * them (`axios.create({ withCredentials: true })`) reach every request.
 */
const AXIOS: RequestClient = {
  drawnWith: { key: 'client', value: 'axios' },
  jsonByDefault: true,
  every: { marks: /withCredentials|defaults|axios\.create/, instance: { method: 'create', receiver: /axios/i }, defaults: true },
};

/** ky and ofetch: an object body goes as JSON. Settings shared by every request are not read for either. */
const KY: RequestClient = { drawnWith: { key: 'client', value: 'ky' }, jsonByDefault: true };
const OFETCH: RequestClient = { drawnWith: { key: 'client', value: 'ofetch' }, jsonByDefault: true };

/** Every client described, in the order a call that fits two descriptions is given to the first. */
export const REQUEST_CLIENTS: readonly RequestClient[] = [ANGULAR_HTTP_CLIENT, AXIOS, KY, OFETCH];

/**
 * The pass every reader that draws requests runs after it has drawn them
 * (P388): the core's reading, knowing the clients described here.
 */
export const requestFactsPass: ExtractorPass<RequestFactsHost> = requestFactsPassOf(REQUEST_CLIENTS);
