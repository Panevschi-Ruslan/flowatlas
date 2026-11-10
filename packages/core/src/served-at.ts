/**
 * Where a deployment's API is served, with the parts the platform assigns left
 * open (P284).
 *
 * A platform that serves an API gives it an address of its own once it is
 * created: an id in the host that no file of the project holds, and a stage the
 * deployment may choose when it is run. The deployment knows everything else -
 * the region in the host, the stage it deploys to by default - and records it
 * beside each route of the API, so a request whose address is written out with
 * the id in it can be taken as the API's without the id being read. Nothing
 * here names a platform: a reader spells the address as a pattern, and the
 * linker matches a host and a path against it.
 */

/** The meta key a route records where its API is served (`ServedAt[]`). */
export const SERVED_AT_META = 'servedAt';

/** One address an API is served at. */
export interface ServedAt {
  /** The host, `*` standing for one label the platform assigns: `*.gateway.region-1.example.test`. */
  readonly host: string;
  /**
   * The segments in front of every route of the API at that host: `['prod']`
   * for a stage, `[]` for none; `'*'` for a stage chosen when the deployment
   * is run, which any segment written there may be.
   */
  readonly base: readonly string[];
  /** The API, by name: the routes of one API are one answer. */
  readonly api: string;
  /** For a base chosen when the deployment is run: what it is where nothing chooses. */
  readonly chosenDefault?: string;
}

/** A request's address matched against one place an API is served. */
export interface ServedMatch {
  readonly served: ServedAt;
  /** The path the request asks the API for, after the base. */
  readonly path: string;
  /** The segments the request writes where the base is: `['dev']`. */
  readonly written: readonly string[];
}

/** One DNS label, which is what a `*` of a host stands for. */
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';

const hostPattern = (host: string): RegExp =>
  new RegExp(`^${host.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join(LABEL)}$`, 'i');

/** Whether a value is a list of `ServedAt`, as a route's meta holds it. */
export const servedAtOf = (value: unknown): readonly ServedAt[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is ServedAt =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as ServedAt).host === 'string' &&
          typeof (item as ServedAt).api === 'string' &&
          Array.isArray((item as ServedAt).base),
      )
    : [];

/**
 * Where a request at `host` asking for `path` lands on an API served at
 * `served`: the path after the base, or `undefined` where the host is not
 * the pattern's or the path does not start with the base.
 */
export const matchServedAt = (host: string, path: string, served: ServedAt): ServedMatch | undefined => {
  if (!served.host.includes('*') ? served.host.toLowerCase() !== host.toLowerCase() : !hostPattern(served.host).test(host)) return undefined;
  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.length < served.base.length) return undefined;
  const written = segments.slice(0, served.base.length);
  if (!served.base.every((segment, at) => segment === '*' || segment === written[at])) return undefined;
  return { served, path: `/${segments.slice(served.base.length).join('/')}`, written };
};
