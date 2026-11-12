import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import {
  NO_PROXY,
  NotLiteral,
  configValueAt,
  proxyPrefixOf,
  proxyRule,
  proxySettingOf,
  proxySettingRule,
  proxyUnreadRow,
  readConfigLiteral,
  toPosixPath,
  type ExtractContext,
  type ProxyReading,
  type ProxyRewrite,
  type ProxyRule,
  type Unresolved,
} from '@flowatlas/core';
import { ts } from 'ts-morph';

/**
 * Where each framework's server forwards a path, as its configuration writes
 * it (P257), in the one shape the core keeps (`ProxyRule`).
 *
 * - the proxy configuration file a webpack or Angular dev server is started
 *   with (`proxy.conf.json`, `proxy.conf.js`): a table of prefixes, or a list
 *   of `{ context, target }`, each with its `pathRewrite`;
 * - Nitro's (and so Nuxt's) `devProxy`, which hands the request on without
 *   the prefix it is mounted at, and a route rule's `proxy`
 *   (`'/api/**': { proxy: 'http://localhost:3001/**' }`);
 * - Next's `rewrites()` to an address outside the application, which the
 *   framework applies after its own files unless they are `beforeFiles`.
 *
 * Vite's `server.proxy` is read beside Vite's other settings, in the front
 * end's reader, with the rewrite reader exported here. Every rule is read
 * only as far as it is written in literals; the rest is a row.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof NotLiteral);

/** The line of a text an offset is on. */
const lineAt = (text: string, offset: number): number => (offset < 0 ? 1 : text.slice(0, offset).split('\n').length);

/** The line a key is first written on, quoted or not, after `from`. */
export const keyLine = (text: string, key: string, from = 0): number => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = new RegExp(`(['"\`])${escaped}\\1\\s*:|(?:^|[\\s{,])${escaped}\\s*:`, 'g');
  at.lastIndex = from;
  const found = at.exec(text);
  if (found !== null) return lineAt(text, found.index + (found[0].length - found[0].trimStart().length));
  // A key written as a value, a context of a list: `context: ['/api']`.
  const quoted = new RegExp(`(['"\`])${escaped}\\1`, 'g');
  quoted.lastIndex = from;
  const value = quoted.exec(text);
  return lineAt(text, value === null ? from : value.index);
};

/** A regular expression or a string a rewrite matches by: `/^\/api/i`, `'^/api'`; a string is matched as written. */
const patternText = (written: string): { source: string; flags: string; literal: boolean } | undefined => {
  const regex = /^\/((?:\\\/|[^/])+)\/([a-z]*)$/.exec(written.trim());
  if (regex !== null) return { source: (regex[1] as string).replace(/\\\//g, '/'), flags: regex[2] as string, literal: false };
  const quoted = /^(['"`])(.*)\1$/.exec(written.trim());
  return quoted === null ? undefined : { source: quoted[2] as string, flags: '', literal: true };
};

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How a pattern of a rewrite rewrites the rule's path, given what it is
 * replaced with: a pattern that is the prefix itself, anchored or not, is a
 * literal replacement of it; any other regular expression the language
 * reads rewrites the whole path where it matches (P260).
 */
const rewriteFor = (pattern: string, replacement: string, prefix: string, flags = ''): ProxyRewrite | undefined => {
  const body = pattern.startsWith('^') ? pattern.slice(1) : pattern;
  const literal = !/[\\()[\]{}*+?.|$]/.test(body.replace(/\\\./g, ''));
  if (literal && prefix !== '' && flags === '' && proxyPrefixOf(body.replace(/\\\./g, '.')) === proxyPrefixOf(prefix)) {
    return replacement === '' || replacement === '/' ? { kind: 'strip' } : { kind: 'replace', with: replacement };
  }
  try {
    new RegExp(pattern, flags);
  } catch {
    return undefined;
  }
  return { kind: 'pattern', source: pattern, ...(flags === '' ? {} : { flags }), with: replacement };
};

/**
 * A rewrite written as a function that replaces the prefix with a literal:
 * `(path) => path.replace(/^\/api/, '')`, `p => p.replace('/api', '/v1')`.
 * Nothing for any other function.
 */
export const rewriteOfFunction = (text: string, prefix: string): ProxyRewrite | undefined => {
  const found = /^\(?\s*([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?\)?\s*=>\s*\{?\s*(?:return\s+)?\1\s*\.\s*replace\s*\(\s*(\/(?:\\\/|[^/\n])+\/[a-z]*|'[^']*'|"[^"]*"|`[^`$]*`)\s*,\s*('[^']*'|"[^"]*"|`[^`$]*`)\s*\)\s*;?\s*\}?\s*$/.exec(text.trim());
  if (found === null) return undefined;
  const pattern = patternText(found[2] as string);
  const replacement = patternText(found[3] as string);
  if (pattern === undefined || replacement === undefined) return undefined;
  // A string replaces itself where it is first written, as an expression of itself would.
  return rewriteFor(pattern.literal ? escaped(pattern.source) : pattern.source, replacement.source, prefix, pattern.flags);
};

/** A `pathRewrite` table, `{ '^/api': '' }`: one entry that rewrites the prefix. */
const rewriteOfTable = (table: unknown, prefix: string): ProxyRewrite | undefined => {
  if (!isRecord(table)) return undefined;
  const entries = Object.entries(table);
  if (entries.length !== 1) return undefined;
  const [pattern, replacement] = entries[0] as [string, unknown];
  return typeof replacement === 'string' ? rewriteFor(pattern, replacement, prefix) : undefined;
};

/** Where a rule is written, and what reads it. */
interface At {
  readonly file: string;
  readonly text: string;
  readonly adapter: string;
  readonly after?: 'own-routes';
}

/**
 * The target a table writes for a prefix, as a rule: an address, or a
 * setting read in code and filled from the service's files (P260).
 */
const targetRule = (prefix: string, target: unknown, how: ProxyRewrite, at: { file: string; line: number; after?: 'own-routes' }): ProxyRule | 'not-written' | 'not-address' => {
  if (typeof target === 'string') return proxyRule(prefix, target, how, at) ?? 'not-address';
  const setting = target instanceof NotLiteral ? proxySettingOf(target.text) : undefined;
  return setting === undefined ? 'not-written' : proxySettingRule(prefix, setting, how, at);
};

/** A prefix as a proxy table names it, or why it is not one: a pattern, a glob with more than a trailing `**`. */
const prefixKey = (key: string): string | undefined => {
  if (!key.startsWith('/')) return undefined;
  const plain = key.replace(/\/\*\*?$/, '');
  return /[*?^$()[\]{}|\\]/.test(plain) ? undefined : plain === '' ? '/' : plain;
};

/** The rule an entry of a proxy table makes, or the row that says why it makes none. */
const tableRule = (
  key: string,
  target: unknown,
  rewrite: (prefix: string) => ProxyRewrite | 'unread',
  at: At,
  line: number,
): { rule?: ProxyRule; row?: Unresolved } => {
  const prefix = prefixKey(key);
  const where = { file: at.file, line };
  if (prefix === undefined) return { row: proxyUnreadRow(where, key, 'its prefix is a pattern, not a path', at.adapter) };
  const how = rewrite(prefix);
  if (how === 'unread') return { row: proxyUnreadRow(where, key, 'its rewrite is not a regular expression replaced by a literal', at.adapter) };
  const rule = targetRule(prefix, target, how, { ...where, ...(at.after === undefined ? {} : { after: at.after }) });
  if (rule === 'not-written') return { row: proxyUnreadRow(where, key, 'its target is not written as an address or a setting', at.adapter) };
  return rule === 'not-address' ? { row: proxyUnreadRow(where, key, `its target (${String(target)}) is not an address`, at.adapter) } : { rule };
};

/**
 * The rules a proxy's `router` table adds (P260): a path key under the
 * prefix sends what it matches to its own target, rewritten as the prefix's
 * rule rewrites. A key with a host routes by the request's host, which a
 * request written with no host does not say: a row.
 */
const routerRules = (key: string, router: unknown, rewrite: (prefix: string) => ProxyRewrite | 'unread', at: At, line: number): Array<{ rule?: ProxyRule; row?: Unresolved }> => {
  const where = { file: at.file, line };
  if (router === undefined) return [];
  if (!isRecord(router)) return [{ row: proxyUnreadRow(where, key, 'its router is not written as a table of literals', at.adapter) }];
  const prefix = prefixKey(key);
  return Object.entries(router).flatMap(([routed, target]): Array<{ rule?: ProxyRule; row?: Unresolved }> => {
    const routedLine = keyLine(at.text, routed, Math.max(0, at.text.indexOf('router')));
    if (!routed.startsWith('/')) return [{ row: proxyUnreadRow({ file: at.file, line: routedLine }, routed, 'its router sends by the request\'s host, which a request with no host does not say', at.adapter) }];
    // A path the prefix does not match never reaches the router.
    if (prefix === undefined || (prefix !== '/' && routed !== prefix && !routed.startsWith(`${prefix}/`))) return [];
    const how = rewrite(prefix);
    if (how === 'unread') return [];
    // What the prefix's rewrite leaves in place of the prefix, with the rest of the routed path behind it.
    const kept = how.kind === 'keep' ? routed : how.kind === 'strip' ? routed.slice(prefix === '/' ? 0 : prefix.length) : how.kind === 'replace' ? `${how.with}${routed.slice(prefix === '/' ? 0 : prefix.length)}` : routed;
    const own = targetRule(routed, target, how.kind === 'pattern' ? how : kept === '' ? { kind: 'strip' } : { kind: 'replace', with: kept }, { file: at.file, line: routedLine, ...(at.after === undefined ? {} : { after: at.after }) });
    if (own === 'not-written') return [{ row: proxyUnreadRow({ file: at.file, line: routedLine }, routed, 'its router target is not written as an address or a setting', at.adapter) }];
    if (own === 'not-address') return [{ row: proxyUnreadRow({ file: at.file, line: routedLine }, routed, `its router target (${String(target)}) is not an address`, at.adapter) }];
    return [{ rule: own }];
  });
};

const collect = (found: ReadonlyArray<{ rule?: ProxyRule; row?: Unresolved }>): ProxyReading => ({
  rules: found.flatMap((each) => (each.rule === undefined ? [] : [each.rule])),
  rows: found.flatMap((each) => (each.row === undefined ? [] : [each.row])),
});

/**
 * The rules of a proxy configuration a webpack or Angular dev server reads:
 * `{ "/api": { "target": "…", "pathRewrite": { "^/api": "" } } }`, a target
 * written as a string, or `[{ "context": ["/api"], "target": "…" }]`.
 */
export const proxyTableRules = (value: unknown, at: At): ProxyReading => {
  const entries: Array<{ key: string; options: unknown }> = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue;
      const context = item['context'];
      for (const key of Array.isArray(context) ? context : [context]) if (typeof key === 'string') entries.push({ key, options: item });
    }
  } else if (isRecord(value)) {
    for (const [key, options] of Object.entries(value)) entries.push({ key, options });
  } else return NO_PROXY;
  return collect(
    entries.map(({ key, options }) => {
      const target = typeof options === 'string' || options instanceof NotLiteral ? options : isRecord(options) ? options['target'] : undefined;
      const table = isRecord(options) ? options['pathRewrite'] : undefined;
      const rewrite = (prefix: string): ProxyRewrite | 'unread' => (table === undefined ? { kind: 'keep' } : (rewriteOfTable(table, prefix) ?? 'unread'));
      const line = keyLine(at.text, key);
      return [tableRule(key, target, rewrite, at, line), ...routerRules(key, isRecord(options) ? options['router'] : undefined, rewrite, at, line)];
    }).flat(),
  );
};

/**
 * A proxy configuration file a dev server is started with, read as JSON or as
 * a module's literal export. Nothing where the file is not there; a row where
 * it is not read.
 */
export const proxyConfigFile = (repoDir: string, written: string, adapter: string, named: { file: string; line: number }): ProxyReading => {
  const path = join(repoDir, written);
  if (!existsSync(path)) return { rules: [], rows: [proxyUnreadRow(named, written, 'the proxy configuration it names is not in the repository', adapter)] };
  const file = toPosixPath(relative(repoDir, path));
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return NO_PROXY;
  }
  if (path.endsWith('.json')) {
    try {
      return proxyTableRules(JSON.parse(text) as unknown, { file, text, adapter });
    } catch {
      return { rules: [], rows: [proxyUnreadRow({ file, line: 1 }, written, 'the file is not JSON', adapter)] };
    }
  }
  const config = readConfigLiteral(dirname(path), [basename(path)]);
  if (config === undefined || config.value instanceof NotLiteral) {
    return { rules: [], rows: [proxyUnreadRow({ file, line: 1 }, written, 'the module does not export its rules as a literal', adapter)] };
  }
  return proxyTableRules(config.value, { file, text, adapter });
};

const NITRO = 'nitro-routes';
const NUXT_CONFIGS = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts', 'nuxt.config.cjs'];
const NITRO_CONFIGS = ['nitro.config.ts', 'nitro.config.js', 'nitro.config.mjs', 'nitro.config.mts'];

/** A route rule's proxy: `'/api/**': { proxy: 'http://x/**' }` or `{ proxy: { to } }`. */
const routeRuleRules = (rules: unknown, at: At, from: number): Array<{ rule?: ProxyRule; row?: Unresolved }> => {
  if (!isRecord(rules)) return [];
  return Object.entries(rules).flatMap(([key, rule]) => {
    if (!isRecord(rule) || rule['proxy'] === undefined) return [];
    const proxy = rule['proxy'];
    const to = isRecord(proxy) ? proxy['to'] : proxy;
    const line = keyLine(at.text, key, from);
    // A target read from a setting, `${process.env.API_URL}/**` (P260).
    const setting = to instanceof NotLiteral ? proxySettingOf(to.text) : undefined;
    if (setting !== undefined && key.endsWith('/**') && (setting.path ?? '').endsWith('/**')) {
      const behind = (setting.path as string).replace(/\/\*\*$/, '');
      return [{ rule: proxySettingRule(key, { name: setting.name, ...(behind === '' ? {} : { path: behind }) }, { kind: 'strip' }, { file: at.file, line }) }];
    }
    if (typeof to !== 'string') return [{ row: proxyUnreadRow({ file: at.file, line }, key, 'its target is not written as an address', at.adapter) }];
    const every = key.endsWith('/**');
    // `/**` on both sides hands the rest of the path on; on the rule alone,
    // every path under it goes to one address, which no path of the request says.
    if (every !== to.endsWith('/**')) return [{ row: proxyUnreadRow({ file: at.file, line }, key, 'it sends every path under it to one address', at.adapter) }];
    return [tableRule(key, to.replace(/\/\*\*$/, ''), () => ({ kind: 'strip' }), at, line)];
  });
};

/** The text of a configuration, with its file relative to the repository. */
const configText = (repoDir: string, path: string): { file: string; text: string } | undefined => {
  try {
    return { file: toPosixPath(relative(repoDir, path)), text: readFileSync(path, 'utf8') };
  } catch {
    return undefined;
  }
};

/**
 * Nitro's and Nuxt's proxies: `devProxy` (under `nitro` in a Nuxt
 * configuration), which mounts the target at its prefix and so takes the
 * prefix off, and every route rule with a `proxy`, in `routeRules` and
 * `nitro.routeRules`. Both are matched before the server's own routes.
 */
export const nitroProxies = (ctx: ExtractContext): ProxyReading => {
  const found: Array<{ rule?: ProxyRule; row?: Unresolved }> = [];
  for (const [names, prefix] of [
    [NUXT_CONFIGS, 'nitro.'],
    [NITRO_CONFIGS, ''],
  ] as const) {
    const config = readConfigLiteral(ctx.repoDir, names);
    const written = config === undefined ? undefined : configText(ctx.repoDir, config.file);
    if (config === undefined || written === undefined) continue;
    const at: At = { ...written, adapter: NITRO };
    const devProxy = configValueAt(config.value, `${prefix}devProxy`);
    if (isRecord(devProxy)) {
      const from = Math.max(0, written.text.indexOf('devProxy'));
      for (const [key, options] of Object.entries(devProxy)) {
        const target = typeof options === 'string' || options instanceof NotLiteral ? options : isRecord(options) ? options['target'] : undefined;
        found.push(tableRule(key, target, () => ({ kind: 'strip' }), at, keyLine(written.text, key, from)));
      }
    } else if (devProxy instanceof NotLiteral) found.push({ row: proxyUnreadRow({ file: written.file, line: keyLine(written.text, 'devProxy') }, `${prefix}devProxy`, 'it is not written as a literal', NITRO) });
    for (const key of prefix === '' ? ['routeRules'] : ['routeRules', 'nitro.routeRules']) {
      const from = key === 'nitro.routeRules' ? Math.max(0, written.text.indexOf('nitro')) : 0;
      found.push(...routeRuleRules(configValueAt(config.value, key), at, Math.max(0, written.text.indexOf('routeRules', from))));
    }
  }
  // A Nitro server resolves a request its own code writes with no host
  // against the address it is served at, as Next's does (P263): its `$fetch`
  // hands one to its own routes in process, and the platform `fetch` has no
  // origin to resolve it against, which the request's own reading says.
  return { ...collect(found), ownOrigin: true };
};

const NEXT = 'nextjs-routes';
const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs', 'next.config.mts'];

const unwrap = (node: ts.Expression): ts.Expression => {
  let at = node;
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isAwaitExpression(at)) at = at.expression;
  return at;
};

/** The initializer of a top-level `const name = …`. */
const constNamed = (file: ts.SourceFile, name: string): ts.Expression | undefined => {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
    }
  }
  return undefined;
};

/** The object a configuration exports: through a constant, a wrapper call's first argument, a function's return. */
const exportedObject = (file: ts.SourceFile, at: ts.Expression | undefined, depth = 0): ts.ObjectLiteralExpression | undefined => {
  if (at === undefined || depth > 4) return undefined;
  const value = unwrap(at);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (ts.isIdentifier(value)) return exportedObject(file, constNamed(file, value.text), depth + 1);
  if (ts.isCallExpression(value)) return exportedObject(file, value.arguments[0], depth + 1);
  if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && !ts.isBlock(value.body)) return exportedObject(file, value.body, depth + 1);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    const returned = (value.body as ts.Block).statements.find(ts.isReturnStatement);
    return exportedObject(file, returned?.expression, depth + 1);
  }
  return undefined;
};

const defaultExport = (file: ts.SourceFile): ts.Expression | undefined => {
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) return statement.expression;
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      statement.expression.left.getText(file) === 'module.exports'
    ) {
      return statement.expression.right;
    }
  }
  return undefined;
};

/** What a function answers: the expression of an arrow's body, or of its first `return`. */
const answerOf = (fn: ts.Node): ts.Expression | undefined => {
  const body = ts.isMethodDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) ? fn.body : undefined;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) return unwrap(body);
  const returned = body.statements.find(ts.isReturnStatement);
  return returned?.expression === undefined ? undefined : unwrap(returned.expression);
};

const literal = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

const propertyOf = (object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  for (const property of object.properties) {
    const key = property.name === undefined ? undefined : ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (key === name && ts.isPropertyAssignment(property)) return unwrap(property.initializer);
  }
  return undefined;
};

/** A trailing catch-all of a path pattern, `/:path*`, `/:slug*`, `/:rest+`. */
const TRAILING = /\/:[A-Za-z_]\w*[*+]$/;

/** One rewrite of Next's, `{ source, destination }`, to an address outside the application. */
const nextRewrite = (object: ts.ObjectLiteralExpression, file: ts.SourceFile, where: string, after: boolean): { rule?: ProxyRule; row?: Unresolved } | undefined => {
  const source = literal(propertyOf(object, 'source'));
  const written = propertyOf(object, 'destination');
  const destination = literal(written);
  const line = file.getLineAndCharacterOfPosition(object.getStart(file)).line + 1;
  const at = { file: where, line };
  // A destination in the application is a rewrite to its own route, not a proxy.
  if (destination !== undefined && destination.startsWith('/')) return undefined;
  // A destination read from a setting, the rest of the path after it (P260).
  const setting = destination === undefined && written !== undefined ? proxySettingOf(written.getText(file)) : undefined;
  if (source !== undefined && setting !== undefined && propertyOf(object, 'has') === undefined && propertyOf(object, 'missing') === undefined) {
    const behind = setting.path ?? '';
    const rest = TRAILING.test(source);
    if (/[:(*]/.test(source.replace(TRAILING, '')) || /[:(*]/.test(behind.replace(TRAILING, '')) || rest !== TRAILING.test(behind)) {
      return { row: proxyUnreadRow(at, source, 'its source or destination has parameters other than one trailing catch-all', NEXT) };
    }
    const plain = behind.replace(TRAILING, '');
    return { rule: proxySettingRule(source.replace(TRAILING, ''), { name: setting.name, ...(plain === '' ? {} : { path: plain }) }, { kind: 'strip' }, { ...at, ...(after ? { after: 'own-routes' as const } : {}) }) };
  }
  if (source === undefined || destination === undefined) return { row: proxyUnreadRow(at, source ?? 'rewrite', 'its source or destination is not written as a literal', NEXT) };
  if (propertyOf(object, 'has') !== undefined || propertyOf(object, 'missing') !== undefined) {
    return { row: proxyUnreadRow(at, source, 'it applies only to requests a condition (has, missing) picks', NEXT) };
  }
  const rest = TRAILING.test(source);
  const plainSource = source.replace(TRAILING, '');
  const plainDestination = destination.replace(TRAILING, '');
  // Only a catch-all handed on whole, or none at all, is a prefix rewritten.
  if (/[:(*]/.test(plainSource) || /[:(*]/.test(plainDestination.replace(/^[a-z]+:\/\/[^/]*/i, '')) || rest !== TRAILING.test(destination)) {
    return { row: proxyUnreadRow(at, source, 'its source or destination has parameters other than one trailing catch-all', NEXT) };
  }
  const rule = proxyRule(plainSource, plainDestination, { kind: 'strip' }, { ...at, ...(after ? { after: 'own-routes' as const } : {}) });
  return rule === undefined ? { row: proxyUnreadRow(at, source, `its destination (${destination}) is not an address`, NEXT) } : { rule };
};

/**
 * Next's rewrites to an address outside the application: what `rewrites()`
 * answers, a list (applied after the application's own files) or
 * `{ beforeFiles, afterFiles, fallback }`. A destination inside the
 * application is a rewrite to its own route, which is not a proxy.
 */
export const nextProxies = (ctx: ExtractContext): ProxyReading => {
  const read = nextRewrites(ctx);
  // A Next server resolves a request its own code writes with no host
  // against the address it is served at (P260).
  return { ...read, ownOrigin: true };
};

const nextRewrites = (ctx: ExtractContext): ProxyReading => {
  const path = NEXT_CONFIGS.map((name) => join(ctx.repoDir, name)).find((each) => existsSync(each));
  const written = path === undefined ? undefined : configText(ctx.repoDir, path);
  if (path === undefined || written === undefined) return NO_PROXY;
  const file = ts.createSourceFile(path, written.text, ts.ScriptTarget.Latest, true, /\.[cm]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const config = exportedObject(file, defaultExport(file));
  if (config === undefined) return NO_PROXY;
  const member = config.properties.find((property) => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === 'rewrites');
  if (member === undefined) return NO_PROXY;
  const fn = ts.isPropertyAssignment(member) ? unwrap(member.initializer) : member;
  const answer = answerOf(fn);
  const line = file.getLineAndCharacterOfPosition(member.getStart(file)).line + 1;
  const lists: Array<{ list: ts.Expression | undefined; after: boolean }> =
    answer !== undefined && ts.isObjectLiteralExpression(answer)
      ? [
          { list: propertyOf(answer, 'beforeFiles'), after: false },
          { list: propertyOf(answer, 'afterFiles'), after: true },
          { list: propertyOf(answer, 'fallback'), after: true },
        ]
      : [{ list: answer, after: true }];
  const found: Array<{ rule?: ProxyRule; row?: Unresolved }> = [];
  for (const { list, after } of lists) {
    if (list === undefined) continue;
    if (!ts.isArrayLiteralExpression(list)) {
      found.push({ row: proxyUnreadRow({ file: written.file, line }, 'rewrites', 'what it answers is not written as a list', NEXT) });
      continue;
    }
    for (const element of list.elements) {
      const value = unwrap(element as ts.Expression);
      if (!ts.isObjectLiteralExpression(value)) {
        found.push({ row: proxyUnreadRow({ file: written.file, line }, 'rewrites', 'an entry is not written as an object', NEXT) });
        continue;
      }
      const read = nextRewrite(value, file, written.file, after);
      if (read !== undefined) found.push(read);
    }
  }
  return collect(found);
};
