import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { frameworkListens, REMIX_ENV, scriptCommands, targetPorts, VITE_CONFIGS, VITE_SERVER_EXECUTORS, WEBPACK_SERVER_EXECUTORS, type ScriptCommand } from '@flowatlas/adapters-entry';
import { NotLiteral, configValueAt, hasAnyDependency, isEnvironmentName, readConfigLiteral, readPackageJson, toPosixPath, type ExtractContext, type ListenPort } from '@flowatlas/core';

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
 *
 * A full-stack framework run through Vite is the exception (P303): Remix's
 * `remix vite:dev`, React Router's `react-router dev` and SvelteKit's `vite
 * dev` serve the application's own routes from Vite's dev server, so where
 * no configuration or script writes its port it listens on Vite's 5173, as
 * the weakest word for a port (P296): a port the code or the files place is
 * not taken from anyone by it, and it places a request only where the
 * application serves it (P300). Astro's own 4321 is read the same way (P310).
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

/** The commands that start a full-stack framework's own routes on Vite's dev server, whatever the application declares. */
const FRAMEWORK_DEV = /\b(?:remix\s+vite:dev|react-router\s+dev|svelte-kit\s+dev)\b/;

/** The packages that make Vite's dev server serve an application's own routes: Remix's and React Router's Vite plugins, SvelteKit. */
const ROUTES_ON_VITE = ['@remix-run/dev', '@react-router/dev', '@sveltejs/kit'] as const;

/** Whether a command starts Vite's dev server serving a full-stack framework's own routes (P303). */
const servesRoutes = (command: string, repoDir: string): boolean => {
  if (FRAMEWORK_DEV.test(command)) return true;
  const pkg = readPackageJson(repoDir);
  return pkg !== undefined && hasAnyDependency(pkg, ROUTES_ON_VITE);
};

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
    else if (server === 'server') {
      // A full-stack framework's dev server, started by a script: on Vite's own port where nothing says (P303).
      const framework = commands.find((each) => servesRoutes(each.command, repoDir));
      if (framework !== undefined) found.push({ port: VITE_DEFAULT.server, file: 'package.json', line: framework.line, default: true, devServer: true });
    }
  }
  return found;
};

/** Astro's own port, for its dev server and its preview alike, where nothing writes one (P310). */
const ASTRO_DEFAULT = 4321;

/**
 * Astro's dev server and preview: `server.port` in its configuration (both
 * read it), and a script's `--port`. Where a script starts one and neither
 * writes its port, it listens on Astro's own 4321 as a default (P310): Astro
 * moves to the next free port when that one is taken, so it is the weakest
 * word for a port (P296) and places a request only where the site serves it
 * (P300, P307).
 */
export const astroListens = (repoDir: string): ListenPort[] => {
  const { ports } = configuredPorts(repoDir, ASTRO_CONFIGS, ['server']);
  const scripts = scriptCommands(repoDir, /\bastro\s+(?:dev|preview)\b/);
  const found: ListenPort[] = [...ports.values()];
  // A `server` written as something not read (`server: ({ command }) => ({ port })`) may set the port: no default.
  const config = readConfigLiteral(repoDir, ASTRO_CONFIGS);
  const serverUnread = config !== undefined && (configValueAt(config.value, 'server') instanceof NotLiteral || configValueAt(config.value, 'server.port') instanceof NotLiteral);
  if (serverUnread && ports.size === 0) return found.concat(scripts.flatMap((each) => (each.port === undefined ? [] : [{ port: each.port, file: 'package.json', line: each.line, devServer: true as const }])));
  for (const preview of [false, true]) {
    const commands = scripts.filter((each) => /\bastro\s+preview\b/.test(each.command) === preview);
    const written = commands.filter((each) => each.port !== undefined);
    for (const each of written) found.push({ port: each.port as number, file: 'package.json', line: each.line, devServer: true });
    if (ports.size > 0 || written.length > 0 || commands.length === 0 || commands.some((each) => each.portUnread === true)) continue;
    found.push({ port: ASTRO_DEFAULT, file: 'package.json', line: (commands[0] as ScriptCommand).line, default: true, devServer: true });
  }
  return found;
};

/** The scripts that start a Remix or React Router application's own server, not a bundler's dev server. */
const APP_SERVES = /\b(?:remix-serve|react-router-serve)\b|\bremix\s+dev\b/;

/**
 * Remix's and React Router's own servers (`remix-serve`, `react-router-serve`,
 * the classic `remix dev`), where a script starts one (P296): they serve the
 * application's resource routes, so they are no dev server, and listen on
 * `PORT`, 3000 where nothing says - or the `PORT` the `.env` that `remix dev`
 * loads gives it (P305).
 */
export const appServerListens = (repoDir: string): ListenPort[] =>
  scriptCommands(repoDir, APP_SERVES).length === 0 ? [] : frameworkListens(repoDir, APP_SERVES, 3000, [], REMIX_ENV);

/**
 * Where a React, Vue or Svelte front end's own servers listen: its bundler's
 * configuration and scripts, and the dev server targets a workspace tool's
 * `project.json` runs it by (P257).
 */
export const frontEndListens = (ctx: ExtractContext): ListenPort[] => [
  ...viteListens(ctx.repoDir),
  ...astroListens(ctx.repoDir),
  ...appServerListens(ctx.repoDir),
  ...targetPorts(ctx.repoDir, VITE_SERVER_EXECUTORS, true),
  ...targetPorts(ctx.repoDir, WEBPACK_SERVER_EXECUTORS, true),
];
