import type { ExtractContext } from './adapters/context.js';
import type { Unresolved } from './model/graph.js';

/**
 * Where a server forwards a path it does not serve itself (P257).
 *
 * A front end's development server, and some frameworks' own servers, are
 * told to hand a prefix of their addresses to another server: everything
 * under `/api` to `http://localhost:3001`, with `/api` taken off on the way.
 * A browser request to `/api/orders`, written with no host because the page
 * is served from the same server, is then a request to `/orders` of whatever
 * listens on 3001. The framework's own configuration says so, and the reader
 * that knows the framework reads it into one shape, kept on the repository
 * node (`meta.proxy`), for the linker to follow a request through.
 *
 * A rule is kept only where every part of it is written as a literal: the
 * prefix it matches, the address it forwards to, and the prefix it puts in
 * place of its own. Anything else - a pattern for a key, an address read from
 * a setting, a rewrite that is not a literal replacement of the prefix - is a
 * row (`proxy-rule-unread`), never a guess.
 */

/** Where the repository node keeps the paths its server forwards. */
export const PROXY_META = 'proxy';

/** One prefix a server forwards, and where to. */
export interface ProxyRule {
  /** The prefix of the request's path it forwards: `/api`. `/` forwards everything. */
  readonly path: string;
  /** The server it forwards to, scheme and host: `http://localhost:3001`. */
  readonly target: string;
  /**
   * What the forwarded path starts with in place of `path`: `/api` where it is
   * kept, `` where it is taken off, `/v1` where it is replaced, the target's
   * own path in front of each.
   */
  readonly to: string;
  /** Repo-relative POSIX path of the file the rule is written in. */
  readonly file: string;
  readonly line: number;
  /**
   * Where the server's own routes answer first and only what they do not
   * serve is forwarded (a rewrite applied after the framework's own files, a
   * proxy for whatever the dev server has no file for). Absent where the rule
   * is matched before the server's own routes.
   */
  readonly after?: 'own-routes';
  /**
   * A regular expression the request's path is matched by, where the rule's
   * key is written as one (P260): `^/legacy/.*`. `path` is then the key as
   * written, and the whole path is forwarded behind `to`, rewritten by
   * `rewrite` where the rule writes one.
   */
  readonly match?: { readonly source: string; readonly flags?: string };
  /** Only the path `path` itself is forwarded, not what is under it (P260). */
  readonly exact?: true;
  /**
   * How the whole path is rewritten, where the rule writes a regular
   * expression for it (P260): replaced where it matches, as a string's
   * `replace` does, or, `whole`, the whole path made the replacement, its
   * groups substituted, as a server's rewrite directive does. The forwarded
   * path is `to` followed by the rewritten one.
   */
  readonly rewrite?: { readonly source: string; readonly flags?: string; readonly with: string; readonly whole?: true };
  /**
   * The target read from a setting the service's own files give a value
   * (P260): `target: process.env.API_URL`. `to` behind the value's own path
   * is what the forwarded path starts with; `target` and the rule's own
   * `to` are the fallback the configuration writes beside it, if any
   * (`target` empty where none is written).
   */
  readonly setting?: { readonly name: string; readonly to: string };
}

/** What a reader found of a server's proxy: the rules it could read, and a row for each it could not. */
export interface ProxyReading {
  readonly rules: readonly ProxyRule[];
  readonly rows: readonly Unresolved[];
  /**
   * The server resolves a request its own code writes with no host against
   * its own address (P260), so such a request is one to its own routes and
   * its own rewrites rather than one nobody can place.
   */
  readonly ownOrigin?: true;
}

/** Where the repository node says its server's own requests with no host reach its own address (P260). */
export const OWN_ORIGIN_META = 'ownOrigin';

export const NO_PROXY: ProxyReading = { rules: [], rows: [] };

/** A path's segments, with no empty ones. */
const segmentsOf = (path: string): string[] => path.split('/').filter((segment) => segment !== '');

/** A prefix as a rule keeps it: one leading slash, no trailing one, `/` for everything. */
export const proxyPrefixOf = (path: string): string => {
  const segments = segmentsOf(path.replace(/\/\*\*?$/, '').replace(/\/:[\w]+\*$/, ''));
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

/** The scheme and host of an address, and its path, or nothing for what is not an address. */
export const proxyTargetOf = (address: string): { origin: string; path: string } | undefined => {
  if (address.includes('${') || /\s/.test(address)) return undefined;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.hostname === '') return undefined;
  const path = segmentsOf(decodeURI(url.pathname));
  return { origin: `${url.protocol}//${url.host.toLowerCase()}`, path: path.length === 0 ? '' : `/${path.join('/')}` };
};

/**
 * How a rule's prefix is replaced on the way: kept, taken off, or put in
 * place of another; or the whole path rewritten by a regular expression
 * (P260), as `path.replace(/^\/api\/v\d+/, '')` writes it.
 */
export type ProxyRewrite =
  | { readonly kind: 'keep' }
  | { readonly kind: 'strip' }
  | { readonly kind: 'replace'; readonly with: string }
  | { readonly kind: 'pattern'; readonly source: string; readonly flags?: string; readonly with: string };

/** What the forwarded path starts with in place of the prefix, the whole path rewritten aside. */
const keptOf = (prefix: string, rewrite: ProxyRewrite): string =>
  rewrite.kind === 'keep'
    ? prefix === '/'
      ? ''
      : prefix
    : rewrite.kind === 'strip' || rewrite.kind === 'pattern'
      ? ''
      : proxyPrefixOf(rewrite.with) === '/'
        ? ''
        : proxyPrefixOf(rewrite.with);

/** The rewrite a rule keeps for a regular expression's, the whole path forwarded behind the target's own. */
const rewriteKept = (rewrite: ProxyRewrite): Pick<ProxyRule, 'rewrite'> =>
  rewrite.kind === 'pattern' ? { rewrite: { source: rewrite.source, ...(rewrite.flags === undefined || rewrite.flags === '' ? {} : { flags: rewrite.flags }), with: rewrite.with } } : {};

/**
 * A rule from what a configuration writes: the prefix, the address, and how
 * the prefix is rewritten. Nothing where the address is not one.
 */
export const proxyRule = (
  path: string,
  address: string,
  rewrite: ProxyRewrite,
  at: { readonly file: string; readonly line: number; readonly after?: 'own-routes' },
): ProxyRule | undefined => {
  const target = proxyTargetOf(address);
  if (target === undefined) return undefined;
  const prefix = proxyPrefixOf(path);
  return {
    path: prefix,
    target: target.origin,
    to: `${target.path}${keptOf(prefix, rewrite)}`,
    file: at.file,
    line: at.line,
    ...(at.after === undefined ? {} : { after: at.after }),
    ...rewriteKept(rewrite),
  };
};

/**
 * A rule whose key is a regular expression (P260): `'^/legacy/.*'`. The whole
 * path is forwarded behind the target's own, rewritten where the rule says.
 */
export const proxyPatternRule = (
  key: string,
  target: Pick<ProxyRule, 'target' | 'to' | 'setting'>,
  rewrite: ProxyRewrite,
  at: { readonly file: string; readonly line: number; readonly after?: 'own-routes' },
): ProxyRule | undefined => {
  try {
    new RegExp(key);
  } catch {
    return undefined;
  }
  return {
    path: key,
    target: target.target,
    to: target.to,
    file: at.file,
    line: at.line,
    ...(at.after === undefined ? {} : { after: at.after }),
    match: { source: key },
    ...rewriteKept(rewrite),
    ...(target.setting === undefined ? {} : { setting: target.setting }),
  };
};

/** A setting a configuration reads a target from, its fallback, and the path written after it. */
export interface ProxySetting {
  readonly name: string;
  /** The literal written beside it, `process.env.API_URL ?? 'http://localhost:3001'`. */
  readonly fallback?: string;
  /** What a template writes after the setting, `${process.env.API_URL}/v1`. */
  readonly path?: string;
}

const SETTING_READ = String.raw`(?:process\.env|import\.meta\.env|env)\s*(?:\.\s*([A-Za-z_][\w]*)|\[\s*['"]([A-Za-z_][\w]*)['"]\s*\])`;

/**
 * The setting a target written as code reads (P260): `process.env.API_URL`,
 * `env.VITE_API_URL` of the values a configuration loads, either with a
 * literal fallback (`??`, `||`), or in a template with a path after it.
 * Nothing for any other code.
 */
export const proxySettingOf = (code: string): ProxySetting | undefined => {
  const written = code.trim().replace(/^\(\s*([^]*?)\s*\)$/, '$1');
  const alone = new RegExp(`^${SETTING_READ}(?:\\s*(?:\\?\\?|\\|\\|)\\s*(['"\`])([^'"\`$]*)\\3)?$`).exec(written);
  if (alone !== null) {
    const name = (alone[1] ?? alone[2]) as string;
    return { name, ...(alone[4] === undefined ? {} : { fallback: alone[4] }) };
  }
  const template = new RegExp(`^\`\\$\\{\\s*${SETTING_READ}\\s*\\}([^\`$]*)\`$`).exec(written);
  if (template !== null) {
    const name = (template[1] ?? template[2]) as string;
    const path = template[3] as string;
    return { name, ...(path === '' ? {} : { path }) };
  }
  return undefined;
};

/**
 * A rule whose target is read from a setting (P260): the prefix, the
 * setting, and how the prefix is rewritten; the fallback, where one is
 * written and is an address, as the rule's own target.
 */
export const proxySettingRule = (
  path: string,
  setting: ProxySetting,
  rewrite: ProxyRewrite,
  at: { readonly file: string; readonly line: number; readonly after?: 'own-routes' },
): ProxyRule => {
  const prefix = proxyPrefixOf(path);
  const kept = keptOf(prefix, rewrite);
  const behind = setting.path === undefined || proxyPrefixOf(setting.path) === '/' ? '' : proxyPrefixOf(setting.path);
  const fallback = setting.fallback === undefined ? undefined : proxyRule(path, setting.fallback, rewrite, at);
  return {
    path: prefix,
    target: fallback?.target ?? '',
    to: fallback?.to ?? `${behind}${kept}`,
    file: at.file,
    line: at.line,
    ...(at.after === undefined ? {} : { after: at.after }),
    ...rewriteKept(rewrite),
    setting: { name: setting.name, to: `${behind}${kept}` },
  };
};

/** The row for a rule that is not read, worded by what was not. */
export const proxyUnreadRow = (at: { readonly file: string; readonly line: number }, key: string, why: string, adapter?: string): Unresolved => ({
  file: at.file,
  line: at.line,
  reason: 'proxy-rule-unread',
  symbol: key,
  message: `the proxy rule for ${key} in ${at.file} is not read: ${why}`,
  hint: 'Write the prefix, the target address and the rewrite as literals, or name the request\'s service with an annotation (/** @flowatlas-calls <service> METHOD /path */).',
  ...(adapter === undefined ? {} : { adapter }),
  meta: { key },
});

/** A rule's regular expression, or nothing where it is not one the language reads. */
const patternOf = (source: string, flags = ''): RegExp | undefined => {
  try {
    return new RegExp(source, flags.replace(/[gy]/g, ''));
  } catch {
    return undefined;
  }
};

/** A path rewritten by a rule's regular expression: in place, or the whole path made the replacement (P260). */
const rewritten = (rewrite: NonNullable<ProxyRule['rewrite']>, path: string): string => {
  const pattern = patternOf(rewrite.source, rewrite.flags);
  if (pattern === undefined) return path;
  // A global expression replaces every place it matches, as the language's own replace does.
  if (rewrite.whole !== true) return path.replace(rewrite.flags?.includes('g') === true ? new RegExp(pattern.source, `${pattern.flags}g`) : pattern, rewrite.with);
  const found = pattern.exec(path);
  return found === null ? path : rewrite.with.replace(/\$(\d+)/g, (_whole, group: string) => found[Number(group)] ?? '').replace(/\$\$/g, '$');
};

/** The whole segments a regular expression's match starts with, written as literals: `^/catalog(/|$)(.*)` is one. */
const literalSegments = (source: string): number => {
  const found = /^(\^?)((?:\\\/|[^\\()[\]{}*+?.|$^])*)/.exec(source);
  const written = found?.[2] ?? '';
  const next = source.slice((found?.[1] ?? '').length + written.length);
  const segments = written.replace(/\\\//g, '/').split('/');
  const last = segments.pop() ?? '';
  // The last part is a whole segment only where what follows it ends one.
  const ended = last !== '' && (next === '' || /^[(/$]/.test(next));
  return segments.filter((segment) => segment !== '').length + (ended ? 1 : 0);
};

/**
 * The rule that forwards a path, and the path it is forwarded as: a rule
 * for the path exactly first (P260), then the rule whose prefix is the
 * longest run of whole segments of the path - a regular expression's by the
 * segments it starts with as literals, and before a prefix as long, as a
 * server tries its patterns first (P260). Nothing where no rule forwards it.
 */
export const forwardedBy = (rules: readonly ProxyRule[], path: string): { rule: ProxyRule; path: string } | undefined => {
  const whole = path.split('?')[0] ?? '';
  const asked = segmentsOf(whole);
  const normal = `/${asked.join('/')}`;
  let best: { rule: ProxyRule; rest: string[]; length: number } | undefined;
  for (const rule of rules) {
    if (rule.match !== undefined) {
      if (patternOf(rule.match.source, rule.match.flags)?.test(normal) !== true) continue;
      // A pattern ties a prefix of its own length and wins it; the first written of two patterns does.
      const length = literalSegments(rule.match.source) + 0.5;
      if (best === undefined || length > best.length) best = { rule, rest: asked, length };
      continue;
    }
    const prefix = segmentsOf(rule.path);
    if (prefix.length > asked.length || prefix.some((segment, index) => asked[index] !== segment)) continue;
    if (rule.exact === true && prefix.length !== asked.length) continue;
    const length = rule.exact === true ? Number.MAX_SAFE_INTEGER : prefix.length;
    if (best === undefined || length > best.length) best = { rule, rest: asked.slice(prefix.length), length };
  }
  if (best === undefined) return undefined;
  if (best.rule.match !== undefined) {
    const after = best.rule.rewrite === undefined ? normal : rewritten(best.rule.rewrite, normal);
    return { rule: best.rule, path: `/${[...segmentsOf(best.rule.to), ...segmentsOf(after)].join('/')}` };
  }
  if (best.rule.rewrite !== undefined) {
    return { rule: best.rule, path: `/${[...segmentsOf(best.rule.to), ...segmentsOf(rewritten(best.rule.rewrite, normal))].join('/')}` };
  }
  const forwarded = [...segmentsOf(best.rule.to), ...best.rest];
  return { rule: best.rule, path: `/${forwarded.join('/')}` };
};

/**
 * Every rule the service's servers forward a path by, as the adapters that
 * read them say: each detected entry and frontend adapter that knows its
 * framework's proxy answers `proxies`. Two readers of one line agree by
 * construction, so a rule is kept once per prefix, file and line; a row once
 * per place.
 */
export const proxiesOf = (ctx: ExtractContext): ProxyReading => {
  const rules = new Map<string, ProxyRule>();
  const rows = new Map<string, Unresolved>();
  let ownOrigin = false;
  for (const adapter of [...ctx.adapters.entry, ...(ctx.adapters.frontend ?? [])]) {
    const read = adapter.proxies?.(ctx);
    if (read === undefined) continue;
    if (read.ownOrigin === true) ownOrigin = true;
    for (const rule of read.rules) {
      const key = [rule.path, rule.file, rule.line].join('\0');
      if (!rules.has(key)) rules.set(key, rule);
    }
    for (const row of read.rows) rows.set([row.file, row.line, row.symbol ?? ''].join('\0'), row);
  }
  const order = (a: ProxyRule, b: ProxyRule): number =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { rules: [...rules.values()].sort(order), rows: [...rows.values()], ...(ownOrigin ? { ownOrigin: true as const } : {}) };
};
