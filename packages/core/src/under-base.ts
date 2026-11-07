import { normalizePath } from './ids.js';

/**
 * An address a front-end reader has read, as far as it could be read.
 *
 * The shape both front-end readers record a request with. Described here, below
 * both, because the one thing they must never disagree about is how a base and
 * an address are put together (P239): a base read by one reader and folded by a
 * second copy of this function is how the two ends of a join come to disagree
 * about the same segment (R114).
 */
export interface ReadAddress {
  /** The address as written, with settings shown as `${key}`. */
  url: string | null;
  /** Path only, with parameters normalised, or null when it could not be read. */
  path: string | null;
  /** Settings key the address is rooted at, when it is. */
  baseUrlEnv: string | null;
  /** Host, when the address names one outright. */
  host: string | null;
  /** How the address was arrived at, for the reader of the node. */
  via: 'literal' | 'template-env' | 'const' | null;
  /** Whether part of the path came from a branch nobody settled. */
  guessed: boolean;
}

/**
 * The route part of an address.
 *
 * A query string and a fragment are arguments to a route rather than part of
 * it, so they are dropped from the path a route is matched on.
 */
const routePathOf = (address: string): string => normalizePath(address.split(/[?#]/)[0] ?? '');

/**
 * Whether an address says anything a path written under it would not.
 *
 * The test for "is this actually a base": a field, an option or an instance
 * holding nothing, or holding `/`, adds no segment to any address written under
 * it, and treating it as a base would make {@link underBase} a rewrite that
 * changes nothing while looking like a reading that succeeded. Asked wherever a
 * base is written - a class's own field, a call's own option, the options an
 * instance is made with, an interceptor - because a base is one fact and two
 * answers to what counts as one is how the two ends of a join come to disagree
 * (R114, R128, P239).
 */
export const isSomewhere = (address: ReadAddress): boolean =>
  address.baseUrlEnv !== null ||
  address.host !== null ||
  (address.path !== null && address.path !== '/');

/**
 * The whole address a request reaches, once the base in front of it is known.
 *
 * An address and a base are one fact read at two ends, and this is the one place
 * the two ends are put together - so what the graph records is the address the
 * request actually reaches, and everything that reads it afterwards, the linker
 * included, is looking at the same string the route side is (R114).
 *
 * The base does not apply to an address the call site rooted itself. A path
 * written with a host of its own, or rooted at a settings key of its own, is not
 * relative to anything the client holds, and putting the two together would
 * invent an address nobody writes. Every client this is asked for agrees: an
 * absolute address wins over the base.
 *
 * *Which* base stands in front is settled before this: the call's own option
 * where the call spells one, and the client's otherwise (R128).
 */
export const underBase = <Address extends ReadAddress>(base: ReadAddress | undefined, address: Address): Address => {
  if (base === undefined || address.path === null) return address;
  if (address.host !== null || address.baseUrlEnv !== null) return address;
  const opening = base.path === null ? '' : base.path.replace(/\/+$/, '');
  if (opening === '' && base.baseUrlEnv === null && base.host === null) return address;
  // A path written without its opening slash (the spelling some clients
  // require under a prefix, `get('orders')`) is the same path: the slash the
  // base ends without is put back once, never twice.
  const written = address.url ?? address.path;
  const joint = written.startsWith('/') ? written : `/${written}`;
  return {
    ...address,
    url: `${(base.url ?? '').replace(/\/+$/, '')}${joint}`,
    path: routePathOf(`${opening}${address.path}`),
    baseUrlEnv: base.baseUrlEnv,
    host: base.host,
    // How the *address* was arrived at, and an address rooted at a settings key
    // is that whichever end of it the key came from.
    via: base.baseUrlEnv === null ? address.via : 'template-env',
    guessed: address.guessed || base.guessed,
  };
};
