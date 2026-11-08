import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { scriptCommands, targetPorts, VITE_CONFIGS, VITE_SERVER_EXECUTORS, WEBPACK_SERVER_EXECUTORS, type ScriptCommand } from '@flowatlas/adapters-entry';
import { NotLiteral, configValueAt, isEnvironmentName, readConfigLiteral, toPosixPath, type ExtractContext, type ListenPort } from '@flowatlas/core';

/**
 * Where a front end's own development and preview servers listen (P254).
 *
 * A SvelteKit `+server.ts`, a Remix resource route or an Astro endpoint is
 * served by the front end's dev server, and a script or another service that
 * calls `http://localhost:5174/api/basket` is calling it. The port is written
 * in the bundler's configuration (`server.port`, `preview.port` in
 * `vite.config.*`; `server.port` in `astro.config.*`) or on the script that
 * starts it (`vite --port 5174`, `vite preview --port 4180`), and both are
 * read, each marked as a dev server's (`devServer`): a dev server forwards
 * what its own routes do not serve, so a request it has no route for is not
 * settled by it.
 *
 * Vite's own defaults - 5173 for the dev server, 4173 for the preview - are
 * read only where `strictPort` says the server may not move: without it Vite
 * takes the next free port, and every scaffold's default is the same, so
 * assuming it would place every two front ends of a project on one port. A
 * default is where it listens only if it listens at all, and says so
 * (`default: true`).
 */

const ASTRO_CONFIGS = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.mts', 'astro.config.cjs'];

/** Vite's documented defaults, where `strictPort` keeps it there. */
const VITE_DEFAULT = { server: 5173, preview: 4173 } as const;

type Server = keyof typeof VITE_DEFAULT;

/** Which of a front end's servers a script command starts, if it starts one. */
const serverOf = (command: string): Server | undefined => {
  if (/\b(?:vite|svelte-kit|astro)\s+preview\b/.test(command)) return 'preview';
  if (/\bvite\s+(?:build|optimize)\b/.test(command)) return undefined;
  if (/\bvite(?:\s+(?:dev|serve))?(?:\s|$)/.test(command)) return 'server';
  if (/\b(?:svelte-kit\s+dev|remix\s+vite:dev|react-router\s+dev|astro\s+dev)\b/.test(command)) return 'server';
  return undefined;
};

const STARTS = /\b(?:vite|svelte-kit|remix|react-router|astro)\b/;

/** The port a configuration writes: a number, or a setting with the number it falls back to, read off its text. */
const configPort = (value: unknown): Pick<ListenPort, 'port' | 'setting'> | undefined => {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 && value < 65536 ? { port: value } : undefined;
  if (typeof value === 'string') return /^\d{2,5}$/.test(value) && Number(value) < 65536 ? { port: Number(value) } : undefined;
  if (!(value instanceof NotLiteral)) return undefined;
  // `Number(process.env.PORT) || 5180`, `process.env.PORT ?? 5180`: the
  // configuration is not evaluated, and only these two spellings are read.
  const match = /process\.env(?:\.([A-Za-z_]\w*)|\[['"]([A-Za-z_]\w*)['"]\])/.exec(value.text);
  const setting = match?.[1] ?? match?.[2];
  if (setting === undefined) return undefined;
  const fallback = /(?:\?\?|\|\|)\s*['"]?(\d{2,5})\b/.exec(value.text)?.[1];
  if (fallback !== undefined && Number(fallback) < 65536) return { setting, port: Number(fallback) };
  return isEnvironmentName(setting) ? { setting } : undefined;
};

/** The line `<section>: { … <key>:` is written on, or the first. */
const keyLine = (text: string, section: string, key: string): number => {
  const at = new RegExp(`\\b${section}\\s*:\\s*\\{[^}]*?\\b${key}\\s*:`).exec(text);
  return at === null ? 1 : text.slice(0, at.index + at[0].length).split('\n').length;
};

/** Every port one configuration file writes for each server it configures. */
const configuredPorts = (
  repoDir: string,
  names: readonly string[],
  servers: readonly Server[],
): { file?: string; ports: Map<Server, ListenPort>; strict: Map<Server, number> } => {
  const config = readConfigLiteral(repoDir, names);
  const ports = new Map<Server, ListenPort>();
  const strict = new Map<Server, number>();
  if (config === undefined) return { ports, strict };
  const file = toPosixPath(relative(repoDir, config.file));
  let text = '';
  try {
    text = readFileSync(config.file, 'utf8');
  } catch {
    return { file, ports, strict };
  }
  for (const server of servers) {
    const written = configPort(configValueAt(config.value, `${server}.port`));
    if (written !== undefined) ports.set(server, { ...written, file, line: keyLine(text, server, 'port'), devServer: true });
    // `preview.strictPort` is `server.strictPort` where it is not written.
    const own = configValueAt(config.value, `${server}.strictPort`);
    const isStrict = own === true || (own === undefined && server === 'preview' && configValueAt(config.value, 'server.strictPort') === true);
    if (isStrict) strict.set(server, keyLine(text, own === true ? server : 'server', 'strictPort'));
  }
  return { file, ports, strict };
};

/**
 * Every port a Vite front end's servers listen on - the dev server and the
 * preview - as its configuration and its scripts write them, with Vite's
 * defaults where `strictPort` keeps it there.
 */
export const viteListens = (repoDir: string): ListenPort[] => {
  const { file, ports, strict } = configuredPorts(repoDir, VITE_CONFIGS, ['server', 'preview']);
  const scripts = scriptCommands(repoDir, STARTS).filter((each) => !/\bastro\b/.test(each.command));
  const found: ListenPort[] = [...ports.values()];
  const started = (server: Server): ScriptCommand[] => scripts.filter((each) => serverOf(each.command) === server);
  for (const server of ['server', 'preview'] as const) {
    const commands = started(server);
    const written = commands.filter((each) => each.port !== undefined);
    for (const each of written) found.push({ port: each.port as number, file: 'package.json', line: each.line, devServer: true });
    if (ports.has(server) || written.length > 0) continue;
    // A preview is only served where a script serves it.
    if (server === 'preview' && commands.length === 0) continue;
    const strictScript = commands.find((each) => each.strict);
    const strictLine = strict.get(server);
    if (strictLine !== undefined && file !== undefined) found.push({ port: VITE_DEFAULT[server], file, line: strictLine, default: true, devServer: true });
    else if (strictScript !== undefined) found.push({ port: VITE_DEFAULT[server], file: 'package.json', line: strictScript.line, default: true, devServer: true });
  }
  return found;
};

/** Astro's dev server: `server.port` in its configuration, and a script's `--port`. Astro's own default is not assumed. */
export const astroListens = (repoDir: string): ListenPort[] => {
  const { ports } = configuredPorts(repoDir, ASTRO_CONFIGS, ['server']);
  const scripts = scriptCommands(repoDir, /\bastro\s+(?:dev|preview)\b/).filter((each) => each.port !== undefined);
  return [...ports.values(), ...scripts.map((each) => ({ port: each.port as number, file: 'package.json', line: each.line, devServer: true as const }))];
};

/**
 * Where a React, Vue or Svelte front end's own servers listen: its bundler's
 * configuration and scripts, and the dev server targets a workspace tool's
 * `project.json` runs it by (P257).
 */
export const frontEndListens = (ctx: ExtractContext): ListenPort[] => [
  ...viteListens(ctx.repoDir),
  ...astroListens(ctx.repoDir),
  ...targetPorts(ctx.repoDir, VITE_SERVER_EXECUTORS, true),
  ...targetPorts(ctx.repoDir, WEBPACK_SERVER_EXECUTORS, true),
];
