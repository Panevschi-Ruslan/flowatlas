import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  keyLine,
  proxyConfigFile,
  rewriteOfFunction,
  targetProxyConfigs,
  VITE_CONFIGS,
  WEBPACK_SERVER_EXECUTORS,
} from '@flowatlas/adapters-entry';
import {
  NO_PROXY,
  NotLiteral,
  configValueAt,
  proxyPatternRule,
  proxyRule,
  proxySettingOf,
  proxySettingRule,
  proxyTargetOf,
  proxyUnreadRow,
  readConfigLiteral,
  toPosixPath,
  type ExtractContext,
  type ProxyReading,
  type ProxyRewrite,
  type ProxyRule,
  type Unresolved,
} from '@flowatlas/core';

/**
 * Where a front end's dev server forwards what it does not serve (P257).
 *
 * A front end written to call `/api/orders` with no host is served, while it
 * is developed, by its own dev server, and the dev server hands `/api` to the
 * service that answers it. Three spellings are read here:
 *
 * - Vite's `server.proxy` (and `preview.proxy`): `'/api': 'http://localhost:3001'`,
 *   or `{ target, rewrite: (path) => path.replace(/^\/api/, '') }`, the
 *   rewrite read only where it replaces the prefix with a literal;
 * - Create React App's `"proxy"` in `package.json`: every request the dev
 *   server has no file for goes to that one address, path and all;
 * - the proxy configuration file a workspace tool's webpack dev server target
 *   names (`proxyConfig` in `project.json`).
 *
 * A key written as a pattern, a target read from a setting, a rewrite that is
 * anything else: a row, never a guess.
 */

const ADAPTER = 'react';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof NotLiteral);

/** One entry of Vite's proxy table: the rule it makes, or the row that says why it makes none. */
const viteEntry = (key: string, options: unknown, at: { file: string; line: number }): { rule?: ProxyRule; row?: Unresolved } => {
  // A key that starts with `^` is a regular expression the whole path is matched by (P260).
  const pattern = key.startsWith('^');
  const target = typeof options === 'string' || options instanceof NotLiteral ? options : isRecord(options) ? options['target'] : undefined;
  const written = isRecord(options) ? options['rewrite'] : undefined;
  let rewrite: ProxyRewrite | undefined = { kind: 'keep' };
  if (written !== undefined) rewrite = written instanceof NotLiteral ? rewriteOfFunction(written.text, pattern ? '' : key) : undefined;
  if (rewrite === undefined) return { row: proxyUnreadRow(at, key, 'its rewrite is not a regular expression replaced by a literal', ADAPTER) };
  // A target read from a setting is filled from the service's own files (P260).
  const setting = target instanceof NotLiteral ? proxySettingOf(target.text) : undefined;
  if (typeof target !== 'string' && setting === undefined) return { row: proxyUnreadRow(at, key, 'its target is not written as an address or a setting', ADAPTER) };
  const literal = typeof target === 'string' ? proxyTargetOf(target) : undefined;
  if (typeof target === 'string' && literal === undefined) return { row: proxyUnreadRow(at, key, `its target (${target}) is not an address`, ADAPTER) };
  if (pattern) {
    const settled = setting === undefined ? undefined : proxySettingRule('/', setting, { kind: 'strip' }, at);
    const rule = proxyPatternRule(key, settled ?? { target: literal?.origin ?? '', to: literal?.path ?? '' }, rewrite, at);
    return rule === undefined ? { row: proxyUnreadRow(at, key, 'its key is not a regular expression the language reads', ADAPTER) } : { rule };
  }
  const rule = setting === undefined ? proxyRule(key, target as string, rewrite, at) : proxySettingRule(key, setting, rewrite, at);
  return rule === undefined ? { row: proxyUnreadRow(at, key, `its target (${String(target)}) is not an address`, ADAPTER) } : { rule };
};

/** Every rule Vite's dev and preview servers forward by. */
export const viteProxies = (repoDir: string): ProxyReading => {
  const config = readConfigLiteral(repoDir, VITE_CONFIGS);
  if (config === undefined) return NO_PROXY;
  const file = toPosixPath(relative(repoDir, config.file));
  let text = '';
  try {
    text = readFileSync(config.file, 'utf8');
  } catch {
    return NO_PROXY;
  }
  const rules: ProxyRule[] = [];
  const rows: Unresolved[] = [];
  for (const server of ['server', 'preview']) {
    const table = configValueAt(config.value, `${server}.proxy`);
    const from = Math.max(0, text.search(new RegExp(`\\b${server}\\s*:\\s*\\{[^]*?\\bproxy\\s*:`)));
    if (table instanceof NotLiteral) {
      rows.push(proxyUnreadRow({ file, line: keyLine(text, 'proxy', from) }, `${server}.proxy`, 'it is not written as a literal', ADAPTER));
      continue;
    }
    if (!isRecord(table)) continue;
    const at = Math.max(0, text.indexOf('proxy', from));
    for (const [key, options] of Object.entries(table)) {
      const found = viteEntry(key, options, { file, line: keyLine(text, key, at) });
      if (found.rule !== undefined && !rules.some((seen) => seen.path === found.rule?.path && seen.target === found.rule.target)) rules.push(found.rule);
      if (found.row !== undefined) rows.push(found.row);
    }
  }
  return { rules, rows };
};

/**
 * Create React App's `"proxy"`: its dev server sends every request it has no
 * file for to the one address, path unchanged, after its own files.
 */
export const reactScriptsProxy = (repoDir: string): ProxyReading => {
  let text: string;
  let proxy: unknown;
  try {
    text = readFileSync(join(repoDir, 'package.json'), 'utf8');
    proxy = (JSON.parse(text) as { proxy?: unknown }).proxy;
  } catch {
    return NO_PROXY;
  }
  if (proxy === undefined) return NO_PROXY;
  const at = { file: 'package.json', line: keyLine(text, 'proxy') };
  if (typeof proxy !== 'string') return { rules: [], rows: [proxyUnreadRow(at, 'proxy', 'it is not one address', ADAPTER)] };
  const rule = proxyRule('/', proxy, { kind: 'keep' }, { ...at, after: 'own-routes' });
  return rule === undefined ? { rules: [], rows: [proxyUnreadRow(at, 'proxy', `${proxy} is not an address`, ADAPTER)] } : { rules: [rule], rows: [] };
};

/** The proxy configuration files a workspace tool's webpack dev server targets are run with. */
const targetProxies = (repoDir: string): ProxyReading[] =>
  targetProxyConfigs(repoDir, WEBPACK_SERVER_EXECUTORS).map((named) => proxyConfigFile(repoDir, named.path, ADAPTER, named));

/** Every rule a React, Vue or Svelte front end's dev servers forward by. */
export const frontEndProxies = (ctx: ExtractContext): ProxyReading => {
  const read = [viteProxies(ctx.repoDir), reactScriptsProxy(ctx.repoDir), ...targetProxies(ctx.repoDir)];
  return { rules: read.flatMap((each) => each.rules), rows: read.flatMap((each) => each.rows) };
};
