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
  /**
   * For a base chosen when the deployment is run: what it is where nothing
   * chooses, or - with `chosenIn` - what the choice `chosenIn` says makes it.
   */
  readonly chosenDefault?: string;
  /**
   * The choice that deploys the base `chosenDefault` names, where it is not
   * what nothing chooses: `the workspace production` for a stage a
   * deployment's workspace other than the default names (P308).
   */
  readonly chosenIn?: string;
  /**
   * For a host part chosen when the deployment is run - a region the host
   * names, `*` in `host`: the host where nothing chooses (P298).
   */
  readonly chosenHost?: string;
  /**
   * What chooses the host part `*` stands for in `host`, where it is not the
   * region: `the workspace` for a custom domain a deployment's workspace names
   * (P322), `chosenHost` then the domain where none is selected.
   */
  readonly hostChosenBy?: string;
  /**
   * What the path every route of the API is drawn at starts with that this
   * place does not write (P298): `/v1` for the routes of an API mapped onto a
   * custom domain at the base path `v1`, read at the API's own address, which
   * serves them without it.
   */
  readonly under?: string;
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
  const after = segments.slice(served.base.length).join('/');
  const under = (served.under ?? '').replace(/\/+$/, '');
  return { served, path: under === '' ? `/${after}` : `${under}${after === '' ? '' : `/${after}`}`, written };
};

/** Whether a request at `host` names the host an API is served at where nothing chooses its region (P298). */
export const atChosenHost = (host: string, served: ServedAt): boolean =>
  served.chosenHost !== undefined && (served.chosenHost.includes('*') ? hostPattern(served.chosenHost).test(host) : served.chosenHost.toLowerCase() === host.toLowerCase());
