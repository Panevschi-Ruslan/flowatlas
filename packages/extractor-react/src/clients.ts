/**
 * The ways a React repository writes a request, described rather than
 * implemented.
 *
 * Angular has one answer to "where is a request written": an injected
 * `HttpClient`, whose type the compiler knows, called in a service class. React
 * has no answer at all. The same repository will reach the network through the
 * browser's own `fetch` in one file, through a client library in another, and
 * through a module of plain functions wrapping either in a third. What they
 * have in common is that a verb, an address and sometimes a body are written at
 * one call site, and they differ only in where each of the three sits.
 *
 * So the same shape the route dialects took: a description per client and one
 * reader over all of them. A new client is a row here, read by code already
 * proved against the others.
 */

/** A type whose values make requests, and the package that declares it. */
export interface ClientType {
  readonly package: string;
  readonly typeName: string;
}

/** Where the verb, the address and the body sit in one call. */
export interface CallShape {
  /** The verb this spelling always means, or null when the call says. */
  readonly method: string | null;
  readonly urlAt: number;
  /** The argument holding the body, when the spelling has one. */
  readonly bodyAt?: number;
  /**
   * An options object whose `method` key names the verb.
   *
   * `fetch(url, { method: 'POST' })` is the only place in any of this where
   * the verb is a value rather than part of the spelling, which is why it is a
   * field and not the rule.
   */
  readonly optionsAt?: number;
}

export interface RequestClient {
  /** How the client is named in `meta.client` and in every row. */
  readonly name: string;
  /**
   * The package that declares it, or null for something the browser provides.
   *
   * A browser global has no package, and a repository that declares one of its
   * own by the same name means something else entirely — which is why the
   * reader checks where the name was declared rather than only what it is.
   */
  readonly package: string | null;
  /** Dependencies any one of which means this client may be in use. */
  readonly packages?: readonly string[];
  /** The client called by its own name: `fetch(url, init)`. */
  readonly callee?: { readonly names: readonly string[] } & CallShape;
  /** Verb methods on a value of one of these types: `api.post(url, body)`. */
  readonly receiver?: {
    readonly types: readonly ClientType[];
    readonly verbs: Readonly<Record<string, CallShape>>;
  };
}

/**
 * The browser's own client, and the one every generated client is built on.
 *
 * The verb lives in an options object rather than in the name, and an options
 * object that is a name rather than something written in place settles nothing
 * — which is a row saying the verb was not read, not a guess at `GET`. A call
 * with no second argument at all is different: the protocol's own default
 * applies and `GET` is what the request is.
 */
export const FETCH: RequestClient = {
  name: 'fetch',
  package: null,
  callee: { names: ['fetch'], method: null, urlAt: 0, optionsAt: 1, bodyAt: 1 },
};

/**
 * The client library most repositories that do not use `fetch` reach for.
 *
 * Both spellings are listed because both are ordinary: `axios.get(url)` on the
 * module itself, and `api.get(url)` on an instance made by `axios.create`,
 * whose type is the same one. The instance is by far the more common of the
 * two in anything larger than a sample, because it is where the base address
 * and the headers are set.
 */
export const AXIOS: RequestClient = {
  name: 'axios',
  package: 'axios',
  packages: ['axios'],
  receiver: {
    types: ['AxiosInstance', 'AxiosStatic'].map((typeName) => ({ package: 'axios', typeName })),
    verbs: {
      get: { method: 'GET', urlAt: 0 },
      delete: { method: 'DELETE', urlAt: 0 },
      head: { method: 'HEAD', urlAt: 0 },
      options: { method: 'OPTIONS', urlAt: 0 },
      post: { method: 'POST', urlAt: 0, bodyAt: 1 },
      put: { method: 'PUT', urlAt: 0, bodyAt: 1 },
      patch: { method: 'PATCH', urlAt: 0, bodyAt: 1 },
    },
  },
};

/** Every client this extractor reads. */
export const REQUEST_CLIENTS: readonly RequestClient[] = [FETCH, AXIOS];
