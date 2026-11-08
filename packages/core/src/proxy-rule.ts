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
}

/** What a reader found of a server's proxy: the rules it could read, and a row for each it could not. */
export interface ProxyReading {
  readonly rules: readonly ProxyRule[];
  readonly rows: readonly Unresolved[];
}

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

/** How a rule's prefix is replaced on the way: kept, taken off, or put in place of another. */
export type ProxyRewrite = { readonly kind: 'keep' } | { readonly kind: 'strip' } | { readonly kind: 'replace'; readonly with: string };

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
  const kept = rewrite.kind === 'keep' ? (prefix === '/' ? '' : prefix) : rewrite.kind === 'strip' ? '' : proxyPrefixOf(rewrite.with) === '/' ? '' : proxyPrefixOf(rewrite.with);
  return {
    path: prefix,
    target: target.origin,
    to: `${target.path}${kept}`,
    file: at.file,
    line: at.line,
    ...(at.after === undefined ? {} : { after: at.after }),
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

/**
 * The rule that forwards a path, and the path it is forwarded as: the rule
 * with the longest prefix that is whole segments of the path. Nothing where
 * no rule forwards it.
 */
export const forwardedBy = (rules: readonly ProxyRule[], path: string): { rule: ProxyRule; path: string } | undefined => {
  const asked = segmentsOf(path.split('?')[0] ?? '');
  let best: { rule: ProxyRule; rest: string[]; length: number } | undefined;
  for (const rule of rules) {
    const prefix = segmentsOf(rule.path);
    if (prefix.length > asked.length || prefix.some((segment, index) => asked[index] !== segment)) continue;
    if (best === undefined || prefix.length > best.length) best = { rule, rest: asked.slice(prefix.length), length: prefix.length };
  }
  if (best === undefined) return undefined;
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
  for (const adapter of [...ctx.adapters.entry, ...(ctx.adapters.frontend ?? [])]) {
    const read = adapter.proxies?.(ctx);
    if (read === undefined) continue;
    for (const rule of read.rules) {
      const key = [rule.path, rule.file, rule.line].join('\0');
      if (!rules.has(key)) rules.set(key, rule);
    }
    for (const row of read.rows) rows.set([row.file, row.line, row.symbol ?? ''].join('\0'), row);
  }
  const order = (a: ProxyRule, b: ProxyRule): number =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { rules: [...rules.values()].sort(order), rows: [...rows.values()] };
};
