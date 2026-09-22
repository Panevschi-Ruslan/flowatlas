import { InvalidChannelNameError, InvalidIdError } from './errors.js';
import type { EntryKind } from './model/nodes.js';

/**
 * Identifier grammar (one place, because everything downstream matches on it):
 *
 *   symbol   <repo>#<file>:<Class>.<method>
 *            <repo>#<file>:<Class>
 *            <repo>#<file>:<fn>
 *   entry    entry:<service>:<kind>:<key>
 *   channel  channel:<name>              — never repo-prefixed
 *   type     type:<repo>#<TypeName>
 *
 * `<repo>` is `services[].name` from the configuration.
 */

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'ALL',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export const isHttpMethod = (value: string): value is HttpMethod =>
  (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());

/** `:id`, `{id}` and `<id>` are all the same hole in a route. */
const PARAM_SEGMENT = /^(?::[^/]+|\{[^/]*\}|<[^/]*>)$/;

/**
 * How far from a route its data access is looked for.
 *
 * One number, because two checks say "this route reaches stored data" and they
 * have to mean the same distance: the guard audit, which asks whether an
 * unguarded route can reach anything, and the contract check, which asks what a
 * stripped field could have cost.
 */
export const DATA_REACH = 8;

export const PARAM_PLACEHOLDER = ':param';

/**
 * What a span of a path nobody could read becomes.
 *
 * Deliberately not `:param`. A route parameter is a hole the route declares and
 * any value fills; this is a hole in what was read. Spelling both the same way
 * is what lets a guess be reported as a reading: an address whose middle could
 * not be read would match the first parameterised route in that position and the
 * edge would say `static` about it.
 *
 * It is kept out of `normalizePath`'s collapsing so it survives to the linker,
 * and it is not shaped like a segment because a hole can swallow a separator —
 * `${base}${tail}` may be one segment or four, and neither the tool nor the
 * reader knows which.
 */
export const UNREAD_SPAN = '${…}';

/**
 * Whether every part of a path was read, rather than stood in for.
 *
 * A path that fails this is not a path. It cannot be matched against a route,
 * counted as a route that was not found, or compared with another path.
 */
export const wasRead = (path: string): boolean => !path.includes(UNREAD_SPAN);

/**
 * What a hole in an assembled address should be written down as.
 *
 * A hole the author put between two separators fills one segment and nothing
 * else. `/orders/${id}` is the route `/orders/:id` whoever `id` turns out to be,
 * and refusing to say so would throw away most of what a browser client is.
 *
 * A hole that opens the address, or that runs straight into other text, could be
 * any number of segments: `${this.url(id)}` is a whole path, `${base}/orders` is
 * a path under a host nobody named. Those become `UNREAD_SPAN` and the address
 * they are in matches nothing, which is the difference between saying "this call
 * reaches that route" and saying "I could not read this call".
 *
 * `before` is the literal text written so far, `after` the literal text that
 * follows the hole, and `last` says whether anything follows the hole at all —
 * an empty `after` with another hole behind it is not the end of the address.
 */
export const holeIn = (before: string, after: string, last: boolean): string => {
  if (!before.endsWith('/')) return UNREAD_SPAN;
  const closed = after === '' ? last : /^[/?#]/.test(after);
  return closed ? PARAM_PLACEHOLDER : UNREAD_SPAN;
};

const required = (part: string, value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidIdError(part, value);
  }
  return value.trim();
};

/**
 * Collapse a route path into the form both sides of a call can be matched on.
 *
 * Leading slash added, trailing slash removed, repeated slashes collapsed, and
 * every parameter segment replaced by `:param`. A `*` wildcard is kept as is,
 * and so is an `UNREAD_SPAN`, which is not a parameter and must not be filed as
 * one. Query strings are not touched — strip them before calling.
 */
export const normalizePath = (path: string): string => {
  const raw = typeof path === 'string' ? path.trim() : '';
  if (raw === '') return '/';
  const segments = raw
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (PARAM_SEGMENT.test(segment) ? PARAM_PLACEHOLDER : segment));
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

/**
 * Bring a file path into the form every id uses: POSIX separators,
 * repo-relative when `repoDir` is given, without a leading `./`.
 */
export const normalizeFilePath = (file: string, repoDir?: string): string => {
  let out = (typeof file === 'string' ? file : '').replace(/\\/g, '/');
  if (typeof repoDir === 'string' && repoDir !== '') {
    const base = repoDir.replace(/\\/g, '/').replace(/\/+$/, '');
    // A repository at the filesystem root leaves nothing to strip but the
    // separator, and a path that keeps it is not repo-relative.
    if (base === '') out = out.replace(/^\/+/, '');
    else if (out === base || out.startsWith(`${base}/`)) out = out.slice(base.length + 1);
  }
  out = out.replace(/\/{2,}/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  return out;
};

/**
 * `<repo>#<file>:<symbol>`, plus `.<member>` for a method.
 *
 * Pass the class name as `symbol` and the method name as `member` for a method;
 * pass a class or function name alone for the declaration itself.
 */
export const makeSymbolId = (
  repo: string,
  file: string,
  symbol: string,
  member?: string,
): string => {
  const r = required('repo', repo);
  const f = normalizeFilePath(required('file', file));
  const s = required('symbol', symbol);
  const suffix = member === undefined ? '' : `.${required('member', member)}`;
  return `${r}#${f}:${s}${suffix}`;
};

/** `entry:<service>:<kind>:<key>` — the key is opaque and kind-specific. */
export const makeEntryId = (service: string, kind: EntryKind, key: string): string =>
  `entry:${required('service', service)}:${required('kind', kind)}:${required('key', key)}`;

/**
 * The `key` half of an HTTP entry id: `POST:/orders/:param`.
 *
 * Kept here so that client and server sides cannot drift apart in how they
 * spell the same route.
 */
export const makeHttpEntryKey = (method: string, path: string): string =>
  `${required('method', method).toUpperCase()}:${normalizePath(path)}`;

/**
 * `channel:<name>` — deliberately without a repo prefix, because the whole
 * point of a channel node is that producer and consumer in different repos land
 * on the same id.
 */
export const makeChannelId = (name: string): string => {
  const value = typeof name === 'string' ? name.trim() : '';
  if (value === '' || value.startsWith('channel:')) {
    throw new InvalidChannelNameError(String(name));
  }
  return `channel:${value}`;
};

/** `type:<repo>#<TypeName>` */
export const makeTypeId = (repo: string, typeName: string): string =>
  `type:${required('repo', repo)}#${required('typeName', typeName)}`;

/** True for ids produced by {@link makeTypeId}. */
export const isTypeId = (id: string): boolean => id.startsWith('type:');

/** True for ids produced by {@link makeChannelId}. */
export const isChannelId = (id: string): boolean => id.startsWith('channel:');

/** True for ids produced by {@link makeEntryId}. */
export const isEntryId = (id: string): boolean => id.startsWith('entry:');

/** Node types whose identity is the place they were found. */
export const SITE_LEAF_TYPES = [
  'db_query',
  'cache_op',
  'http_out',
  'producer',
  'ui_action',
  'ui_api_call',
] as const;

export type SiteLeafType = (typeof SITE_LEAF_TYPES)[number];

/**
 * `<type>:<repo>#<file>:<line>:<col>` — a leaf identified by its call site.
 *
 * Two calls to the same table from two places are two leaves, because what a
 * reader wants to know is which line reaches the data, not merely that some line
 * does.
 */
export const makeLeafId = (
  type: SiteLeafType,
  repo: string,
  file: string,
  line: number,
  column: number,
): string =>
  `${required('type', type)}:${required('repo', repo)}#${normalizeFilePath(required('file', file))}:${line}:${column}`;

/** `table:<repo>#<name>` — repo-scoped, since two services rarely share a store. */
export const makeTableId = (repo: string, name: string): string =>
  `table:${required('repo', repo)}#${required('name', name)}`;

/** `config_key:<repo>#<KEY>` */
export const makeConfigKeyId = (repo: string, key: string): string =>
  `config_key:${required('repo', repo)}#${required('key', key)}`;

/**
 * `external_api:<host>` — deliberately without a repo prefix, like a channel, so
 * that asking who talks to a third party has one node to look at.
 */
export const makeExternalApiId = (host: string): string =>
  `external_api:${required('host', host).toLowerCase()}`;
