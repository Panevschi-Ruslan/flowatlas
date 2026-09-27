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

import type { ApiUrl } from './util/url.js';

/** A type whose values make requests, and the package that declares it. */
export interface ClientType {
  /**
   * The package declaring the type, or null when the repository being read does.
   *
   * Null is not a placeholder. A client class a project wrote itself is declared
   * in no package at all, and that absence is the whole of what tells it apart
   * from a type of the same name installed from somewhere — which is why the
   * description carries it rather than the reader inferring it from the name.
   */
  readonly package: string | null;
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
  /**
   * The address the client puts in front of every path written through it.
   *
   * Absent for the two installed clients, and not because they have no such
   * thing: `axios.create({ baseURL })` is exactly this, and where it is set is a
   * question about one call in one file rather than about a class this repository
   * declares. A client of a project's own keeps its base in a field, and that
   * field is read where the class is (R114).
   */
  readonly base?: ApiUrl;
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
 * A verb named as a method, and where the parts of that call sit.
 *
 * One table, shared by every client spelled this way, because the spelling is
 * not any one client's invention: `post(url, body)` is what `axios` does, what
 * every generated client does, and what a class somebody wrote this morning
 * does, and they agree because there is nowhere else for the two arguments to
 * go. A client that names its verbs otherwise says so in its own row; a client
 * that names them this way says nothing and is read by this.
 *
 * The four verbs with no `bodyAt` are the ones whose second argument is not a
 * body — `get(url, params)` puts it in the query string — and recording a body
 * type for them would describe a request nobody makes.
 */
export const VERB_CALLS: Readonly<Record<string, CallShape>> = {
  get: { method: 'GET', urlAt: 0 },
  delete: { method: 'DELETE', urlAt: 0 },
  head: { method: 'HEAD', urlAt: 0 },
  options: { method: 'OPTIONS', urlAt: 0 },
  post: { method: 'POST', urlAt: 0, bodyAt: 1 },
  put: { method: 'PUT', urlAt: 0, bodyAt: 1 },
  patch: { method: 'PATCH', urlAt: 0, bodyAt: 1 },
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
    verbs: VERB_CALLS,
  },
};

/** Every client this extractor reads without being told anything. */
export const REQUEST_CLIENTS: readonly RequestClient[] = [FETCH, AXIOS];

/**
 * A client class the repository being read wrote itself.
 *
 * This is the shape the two rows above cannot describe and the one most front
 * ends are actually written in: a class wrapping `fetch` behind `get` and
 * `post`, exported as a single instance, with every request in the application
 * written through it. Nothing about it is installed, so no dependency announces
 * it and no fixed row can name it; the description has to be made out of the
 * class itself, which is what this is for.
 *
 * It is the same row `axios` gets, with two differences and no third. The
 * package is null because there is none. The verbs are the ones the class
 * declares rather than all seven, so a class with `get` and `post` is never
 * read as answering to `patch` — which matters, because a name a class does not
 * declare is a name that means something else wherever it does appear.
 * Everything after that — the shape of the call, the body, the address, the row
 * when the address cannot be read — is the code already proved against the two.
 *
 * The base is the third difference and it arrived later, with the defect that
 * made it worth having: a client holding `/api` and writing `/documents.info` at
 * every call site is an address that matches a route only for as long as the
 * route is missing the same segment (R114).
 */
export const localClient = (
  typeName: string,
  verbs: readonly string[],
  base?: ApiUrl,
): RequestClient => ({
  name: typeName,
  package: null,
  ...(base === undefined ? {} : { base }),
  receiver: {
    types: [{ package: null, typeName }],
    verbs: Object.fromEntries(
      verbs.flatMap((verb) => {
        const shape = VERB_CALLS[verb];
        return shape === undefined ? [] : [[verb, shape] as const];
      }),
    ),
  },
});
