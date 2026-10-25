import { InvalidChannelNameError, InvalidIdError } from './errors.js';
import type { EntryKind } from './model/nodes.js';

/**
 * Identifier grammar (one place, because everything downstream matches on it):
 *
 *   symbol   <repo>#<file>:<Class>.<method>
 *            <repo>#<file>:<Class>
 *            <repo>#<file>:<fn>
 *   entry    entry:<service>:<kind>:<key>
 *            entry:<service>@<application>:<kind>:<key>
 *            entry:<service>:invoke:<deployed-name>
 *            entry:<service>:invoke:${…}@<declaration>   — a function whose name
 *                                                        was not read
 *            entry:<service>:workflow:<deployed-name>
 *            entry:<service>:workflow:${…}@<declaration>  — a workflow whose
 *                                                        name was not read
 *   state    <repo>#<file>:<workflow>/<state>   — one step of a workflow; a
 *                                                symbol id whose symbol is the
 *                                                workflow's name and the step's
 *   reference <kind>:<key>               — an entry named without its service,
 *                                          which is how something that knows
 *                                          only a deployed name points at one
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
 * A segment already read into holes among literal text (SvelteKit's `[a]-[b]`
 * is `:param-:param`), which is its own address and not one hole: collapsing it
 * would make it claim the bare `[id]` beside it.
 */
const HOLES_AMONG_TEXT = /^(?!:param$).*:param(?![\w$])/;

const isParamSegment = (segment: string): boolean => PARAM_SEGMENT.test(segment) && !HOLES_AMONG_TEXT.test(segment);

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
    .map((segment) => (isParamSegment(segment) ? PARAM_PLACEHOLDER : segment));
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

/** A path with forward slashes only, whatever the OS wrote it with (P83). */
export const toPosixPath = (path: string): string => (path.includes('\\') ? path.replace(/\\/g, '/') : path);

/** A drive letter, `C:/`, at the head of a POSIX-spelled Windows path. */
const DRIVE = /^[A-Za-z]:(?:\/|$)/;

/**
 * A POSIX-spelled path as two of them are compared (P83): a drive letter is
 * one drive whatever its case, so `c:/work` and `C:/work` are one place.
 * Nothing else about case is decided here.
 */
export const pathKey = (path: string): string => (DRIVE.test(path) ? `${path.charAt(0).toUpperCase()}${path.slice(1)}` : path);

/** A path as two paths are compared: forward slashes, the drive letter in one case, no trailing separator. */
const comparable = (path: string): string => {
  const key = pathKey(toPosixPath(path));
  return key.length > 1 && key.endsWith('/') ? key.replace(/\/+$/, '') : key;
};

/**
 * Whether a path is a directory or inside it, both spelled any way the OS
 * writes them (P83, P199): compared with forward slashes, a drive letter in any
 * case. The compiler names every file with forward slashes on Windows too,
 * while `path.join` and `path.resolve` give backslashes, so a test written as
 * `path.startsWith(dir + '/')` on two such paths is false there for every file.
 */
export const isWithinDir = (path: string, dir: string): boolean => {
  const at = comparable(path);
  const base = comparable(dir);
  return at === base || at.startsWith(base.endsWith('/') ? base : `${base}/`);
};

/** Whether a path is inside a directory and not the directory itself, spelled either way (P199). */
export const isBelowDir = (path: string, dir: string): boolean => comparable(path) !== comparable(dir) && isWithinDir(path, dir);

/** The root a POSIX-spelled absolute path starts at: `/`, or a drive as `C:`; undefined for a relative one. */
const rootOfPath = (path: string): string | undefined =>
  path.startsWith('/') ? '/' : DRIVE.test(path) ? path.slice(0, 2).toUpperCase() : undefined;

/**
 * Bring a file path into the form every id uses: POSIX separators,
 * repo-relative when `repoDir` is given, without a leading `./`.
 *
 * Whatever the OS (P83): a Windows path, with backslashes or with the forward
 * slashes the compiler hands over, is named the way a POSIX one is. A drive
 * letter is compared without its case, and a path on another drive than the
 * repository stays absolute, because no relative path leads there.
 */
export const normalizeFilePath = (file: string, repoDir?: string): string => {
  let out = toPosixPath(typeof file === 'string' ? file : '');
  if (typeof repoDir === 'string' && repoDir !== '') {
    const base = pathKey(toPosixPath(repoDir).replace(/\/+$/, ''));
    const key = pathKey(out);
    // A repository at the filesystem root leaves nothing to strip but the
    // separator, and a path that keeps it is not repo-relative.
    if (base === '') out = out.replace(/^\/+/, '');
    else if (key === base || key.startsWith(`${base}/`)) out = out.slice(base.length + 1);
    // A file the service reads that is not inside it — a handler body in a
    // sibling workspace package — is still named relative to the service,
    // because that is what every other path in its graph is relative to. It
    // used to keep the absolute path it was found at, which put one machine's
    // home directory into node ids: a scheduling app's graph carried fifty-eight of
    // them. Climbing out of the service is a shorter and truer way to say the
    // same thing, and it is the same on every machine.
    else if (rootOfPath(key) !== undefined && rootOfPath(key) === rootOfPath(base)) {
      const from = base.split('/');
      const to = key.split('/');
      let shared = 0;
      while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
      const up = '../'.repeat(from.length - shared);
      out = `${up}${out.split('/').slice(shared).join('/')}`;
    }
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

/**
 * `entry:<service>:<kind>:<key>` — the key is opaque and kind-specific.
 *
 * An address is only an address within an application, so one service that
 * creates two of them has two address spaces and `application` says which one
 * this entry is in. Without it the second application's `/health` lands on the
 * first's id, the builder keeps the node it already has, and the file that
 * declared the loser contributes nothing at all — no node, no row, and every
 * total still correct (R119).
 *
 * It qualifies the service rather than the key because the key is what the two
 * sides of a join both spell: a caller naming a verb and a path reproduces the
 * key, and it has nothing to say about which application answers. The one place
 * that takes an id apart reads the key half by position, and that position does
 * not move.
 *
 * Absent for a service that creates one application, or whose applications were
 * not read: naming the only application there is adds a word to every id and no
 * information, and an id that says nothing about applications is exactly the
 * claim that this service has one address space.
 */
export const makeEntryId = (
  service: string,
  kind: EntryKind,
  key: string,
  application?: string,
): string => {
  const where =
    application === undefined
      ? required('service', service)
      : `${required('service', service)}@${required('application', application)}`;
  return `entry:${where}:${required('kind', kind)}:${required('key', key)}`;
};

/**
 * The `key` half of an HTTP entry id: `POST:/orders/:param`.
 *
 * Kept here so that client and server sides cannot drift apart in how they
 * spell the same route.
 */
export const makeHttpEntryKey = (method: string, path: string): string =>
  `${required('method', method).toUpperCase()}:${normalizePath(path)}`;

/**
 * The `key` half of an HTTP entry id for a route that one API, of several in a
 * deployment serving the same method and path, answers: `GET:/orders@api:billing`.
 *
 * Used only where two APIs (or two load balancers) of one deployment serve the
 * same method and path, so a deployment with one API keeps the plain key.
 * `api` is the API's name, or its declaration's address where the name is not
 * read; `listener` is given where two listeners of one load balancer send the
 * same method and path to different targets (P61):
 * `GET:/health@api:staff-lb@listener:HTTPS:443`.
 */
export const makeApiRouteEntryKey = (method: string, path: string, api: string, listener?: string): string =>
  `${makeHttpEntryKey(method, path)}@api:${required('api', api)}${listener === undefined ? '' : `@listener:${required('listener', listener)}`}`;

/**
 * The `key` half of a function URL's entry id: `ALL:/*@card-lookup`.
 *
 * A function URL answers every verb and every path, so its method and path are
 * the same for every one; the function it stands in front of, and the alias
 * where one is named, is what tells two of them apart.
 */
export const makeFunctionUrlEntryKey = (fn: string, qualifier?: string): string =>
  `${makeHttpEntryKey('ALL', '/*')}@${required('fn', fn)}${qualifier === undefined ? '' : `:${qualifier}`}`;

/**
 * The `key` half of an `invoke` entry id: the name the function is deployed
 * under, exactly as the deployment spells it.
 *
 * The name is the whole address. Whatever invokes a function - a route, a
 * workflow, a rule, another function - names it and nothing else, and the
 * linker joins the two on this key alone, across services.
 */
export const makeInvokeEntryKey = (name: string): string => required('name', name);

/**
 * The `key` of an `invoke` entry whose deployed name was not read.
 *
 * It still needs an id - the function exists, and its handler is often known -
 * but nothing may join to it by name, so the key is built from where it is
 * declared rather than from the parts of the name that did evaluate (I3). It
 * starts with `UNREAD_SPAN`, which no deployed name can contain, so it can never
 * be mistaken for one and `wasRead` says no to it.
 */
export const makeUnnamedInvokeKey = (declaration: string): string =>
  `${UNREAD_SPAN}@${required('declaration', declaration)}`;

/**
 * The `key` half of a `workflow` entry id: the name the workflow is deployed
 * under, exactly as the deployment spells it.
 *
 * The name is the whole address. Whatever starts a workflow - another
 * workflow, a rule, a handler - names it and nothing else, so two sides that
 * never read each other can still agree on it.
 */
export const makeWorkflowEntryKey = (name: string): string => required('name', name);

/**
 * The `key` of a `workflow` entry whose deployed name was not read, for the
 * reason {@link makeUnnamedInvokeKey} gives: the steps are still worth drawing,
 * and nothing may join to them by a name made of the parts that were read.
 */
export const makeUnnamedWorkflowKey = (declaration: string): string =>
  `${UNREAD_SPAN}@${required('declaration', declaration)}`;

/**
 * `<repo>#<file>:<workflow>/<state>` — one step of a workflow.
 *
 * A symbol id like any other, so everything that walks functions walks steps.
 * The step's name is unique within its workflow, and `/` is not part of any
 * name a function or a class can have, so a step can never take the id of a
 * declaration in the same file.
 */
export const makeStateId = (repo: string, file: string, workflow: string, state: string): string =>
  makeSymbolId(repo, file, `${required('workflow', workflow)}/${required('state', state)}`);

/**
 * The keys of `meta` that make a chain of steps a chain to a walk, without the
 * walk asking what kind of thing it is walking (I8).
 *
 * `STEPS_META` is on the node a chain starts from, and says how many steps the
 * chain holds; `STEP_OF_META` is on each step, and names the chain it is one
 * step of. A walk goes one hop per step, and a chain longer than the hops a walk
 * is allowed would be cut off part-way, so a walk is lengthened by the steps it
 * goes through: down from the start by the count, back up by the steps it
 * climbs.
 */
export const STEPS_META = 'states';
export const STEP_OF_META = 'workflow';

/**
 * `<kind>:<key>` — an entry named without the service it is in.
 *
 * Something that knows only the name a thing is deployed under - a step that
 * starts another workflow, say - cannot know which service declares it, and
 * must not guess. It records this instead, and the linker joins it to the one
 * entry, in whichever service, whose id ends in it ({@link entryReferenceOf}).
 * The key is built by the same helper on both sides, so the two cannot drift
 * apart in how they spell one name, which is the argument for
 * {@link makeHttpEntryKey} too.
 */
export const makeEntryReference = (kind: EntryKind, key: string): string =>
  `${required('kind', kind)}:${required('key', key)}`;

/**
 * The key of a node's `meta` that holds the references it reaches by name.
 *
 * A list of {@link makeEntryReference} strings. The node does not draw the
 * edges itself, because it cannot know which service declares what it names;
 * the linker draws one `calls` edge per reference that names exactly one entry,
 * and a row for each that names none or several.
 */
export const REACHES_META = 'reaches';

/** How a node reaches one of its {@link REACHES_META} references, where that is not a plain `calls`. */
export interface ReachedAs {
  /** `triggers` for a run's outcome handed on (P54); `calls` otherwise. */
  readonly type?: 'calls' | 'triggers';
  /** The outcome the edge carries: a destination's, or an IoT rule's error action (P60). */
  readonly when?: 'success' | 'failure';
}

/**
 * The key of a node's `meta` that says, per reference it reaches, how: a map
 * from a {@link REACHES_META} reference to its {@link ReachedAs}. A reference
 * missing from it is reached by a plain `calls` edge, so a destination named
 * elsewhere carries its outcome as surely as one this deployment creates (P60).
 */
export const REACHED_AS_META = 'reachedAs';

/**
 * The key of a node's `meta` naming the function whose run it hands on, where
 * that function is created by another deployment: a
 * {@link makeEntryReference} to its `invoke` entry, which the linker joins by
 * a `triggers` edge into this node, carrying the outcome under `meta.when` (P60).
 */
export const RESULT_OF_META = 'resultOf';

/** The kinds of entry a deployed name is the whole address of. */
export type DeployedEntryKind = Extract<EntryKind, 'invoke' | 'workflow'>;

const DEPLOYED_KEYS: Readonly<Record<DeployedEntryKind, (name: string) => string>> = {
  invoke: makeInvokeEntryKey,
  workflow: makeWorkflowEntryKey,
};

export const isDeployedEntryKind = (value: unknown): value is DeployedEntryKind =>
  typeof value === 'string' && Object.hasOwn(DEPLOYED_KEYS, value);

/**
 * The reference to whatever is deployed under `name` as an entry of `kind`,
 * its key built by the helper that builds the entry's own.
 */
export const makeDeployedReference = (kind: DeployedEntryKind, name: string): string =>
  makeEntryReference(kind, DEPLOYED_KEYS[kind](name));

/**
 * The key of a node's `meta` that says what it starts: the kind of entry the
 * deployed name its address reads is the name of (P24).
 *
 * Code that starts a workflow or invokes a function addresses it the way code
 * that publishes addresses a channel, often by a value of its environment, so
 * its address waits on the deployment in the same shape (`meta.awaiting`). This
 * says that the address, once complete, is a {@link REACHES_META} reference
 * rather than a channel.
 */
export const STARTS_META = 'starts';

/**
 * The reference an entry id answers to, or `undefined` for an id that is not
 * an entry's.
 *
 * `entry:loans@public:http:GET:/x` answers `http:GET:/x`: the service, and the
 * application with it, are exactly what a reference leaves out.
 */
export const entryReferenceOf = (id: string): string | undefined => {
  if (!isEntryId(id)) return undefined;
  const rest = id.slice('entry:'.length);
  const cut = rest.indexOf(':');
  return cut < 0 ? undefined : rest.slice(cut + 1);
};

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
