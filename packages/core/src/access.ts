/**
 * What stands between a request and a way in, and where each piece was put (P76).
 *
 * The chain in front of a route is already drawn, as `guarded_by` edges in the
 * order it runs. What the edges do not say is the answer a reader asks for
 * first: *is this route covered, by what, and from where* — the whole
 * application, a module, the class the handler is on, or the handler itself —
 * and whether the handler opted out of any of it. A reader that knows the
 * framework writes that answer on the entry under `meta.access`, so the audit,
 * the page and the tools for agents all say the same thing without each
 * re-deriving it from the edges.
 */

/** Where a check was attached, from the widest to the narrowest. */
export const ACCESS_WHERE = ['global', 'module', 'controller', 'route'] as const;

export type AccessWhere = (typeof ACCESS_WHERE)[number];

/** One check in front of a way in that can refuse a request. */
export interface AccessGuard {
  /** Id of the node the `guarded_by` edge points at. */
  id: string;
  /** The check's name, as its node is labelled. */
  name: string;
  layer: 'guard' | 'middleware';
  where: AccessWhere;
  /** How it was attached, in words: `APP_GUARD in AuthModule`, `@UseGuards on OrdersController`. */
  via: string;
  /** Repo-relative file and line of the attachment. */
  file?: string;
  line?: number;
  /**
   * The decorator on this handler or its class that switches this check off
   * for it, read off the check itself reading the flag the decorator sets.
   */
  skippedBy?: string;
}

/**
 * A decorator on the handler or its class that sets a flag a check may read
 * to let the request through: `@Public()` setting `isPublic` to `true`.
 */
export interface AccessOptOut {
  /** The decorator as written on the handler or the class. */
  decorator: string;
  /** The metadata key it sets, when it could be read. */
  key?: string;
  /**
   * Whether the decorator or its key says the route is open on purpose
   * (`Public`, `isPublic`, `AllowAnonymous`), rather than that one check is
   * switched off for it.
   */
  public: boolean;
  /** The checks in front of this route that read the flag, by name. */
  skips: string[];
  where: 'controller' | 'route';
  file?: string;
  line?: number;
}

export interface RouteAccess {
  /** The checks in front of the way in, in the order they run. */
  guards: AccessGuard[];
  /** Opt-outs written on the handler or its class. */
  optOuts?: AccessOptOut[];
}

/** The key on an entry's `meta` that holds its access. */
export const ACCESS_META = 'access';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isGuard = (value: unknown): value is AccessGuard =>
  isObject(value) && typeof value['id'] === 'string' && typeof value['name'] === 'string' && typeof value['where'] === 'string';

const isOptOut = (value: unknown): value is AccessOptOut =>
  isObject(value) && typeof value['decorator'] === 'string' && Array.isArray(value['skips']);

/** The access a node's `meta` holds, read defensively; absent when it holds none. */
export const accessOf = (node: { meta?: Record<string, unknown> } | undefined): RouteAccess | undefined => {
  const value = node?.meta?.[ACCESS_META];
  if (!isObject(value)) return undefined;
  const guards = Array.isArray(value['guards']) ? value['guards'].filter(isGuard) : [];
  const optOuts = Array.isArray(value['optOuts']) ? value['optOuts'].filter(isOptOut) : [];
  if (guards.length === 0 && optOuts.length === 0) return undefined;
  return { guards, ...(optOuts.length === 0 ? {} : { optOuts }) };
};

/**
 * Whether a name says "open on purpose".
 *
 * Read off the decorator's name and the key it sets, because those are the two
 * words the author chose. A decorator that switches one named check off
 * (`SkipTenantCheck`) is a decision too, but a narrower one, and the audit
 * reports it as such rather than as a public route.
 */
export const PUBLIC_WORDS = /public|anonymous|allow[-_]?anon|guest|unauthenticated|no[-_]?auth|skip[-_]?auth|without[-_]?auth|open[-_]?access/i;

export const soundsPublic = (...names: ReadonlyArray<string | undefined>): boolean =>
  names.some((name) => name !== undefined && PUBLIC_WORDS.test(name));

/**
 * Whether a flag's name says it lets a request through rather than holding it
 * to more.
 *
 * A check that reads a flag may read it either way: `@Public()` lets a request
 * past the check, `@StrictAuth()` makes the same check refuse more. Both set a
 * key to `true` and both are read by the check, so the only thing that tells
 * them apart without running the check is the word the author chose. Asked of
 * the decorator's name and the key, and a flag that says neither is not taken
 * for an opt-out — a check counted as switched off when it is not would hide
 * the one route it protects.
 */
export const OPT_OUT_WORDS = /skip|bypass|ignore|exclude|exempt|disable|optional|allow|without|public|anonymous|guest|unauth|no[-_]?auth|open[-_]?access/i;

export const soundsLikeOptOut = (...names: ReadonlyArray<string | undefined>): boolean =>
  names.some((name) => name !== undefined && OPT_OUT_WORDS.test(name));

/**
 * The words a check of who is asking is named with (P90): the stems a word of
 * the name starts with.
 */
export const AUTH_CHECK_WORDS: readonly string[] = [
  'auth',
  'verif',
  'permission',
  'access',
  'allowed',
  'entitle',
  'role',
  'member',
  'employee',
  'session',
  'token',
  'signature',
  'credential',
];

const AUTH_CHECK_STEM = new RegExp(`^(?:${AUTH_CHECK_WORDS.join('|')})`, 'i');

/** `LibrarianAuth` → `librarian`, `auth`; `verify_token` → `verify`, `token`. */
const wordsOfName = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);

/**
 * Whether the names of a check say it is about who is asking (P90).
 *
 * Asked of the call whose result a handler tests right before it refuses a
 * request - the function's name and the type of what it is called on - because
 * those are the code's own words for what it checks. Each name is cut into
 * words and a word counts when it starts with one of `AUTH_CHECK_WORDS`, so
 * `verifyMembership` and `LibrarianAuth` do and `remember`, `parse`, `validate`
 * and `load` do not. Never asked of a route's path or verb: a route is not
 * checked or public by what it is called.
 */
export const soundsLikeAuthCheck = (...names: ReadonlyArray<string | undefined>): boolean =>
  names.some((name) => name !== undefined && wordsOfName(name).some((word) => AUTH_CHECK_STEM.test(word)));
