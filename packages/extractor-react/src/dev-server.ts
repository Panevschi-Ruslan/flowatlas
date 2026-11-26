import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  envFilePort,
  frameworkListens,
  REMIX_ENV,
  scriptCommands,
  targetPorts,
  VITE_CONFIGS,
  VITE_SERVER_EXECUTORS,
  WEBPACK_SERVER_EXECUTORS,
  type EnvLoading,
  type ScriptCommand,
} from '@flowatlas/adapters-entry';
import {
  NotLiteral,
  configValueAt,
  hasAnyDependency,
  isEnvironmentName,
  parseSyntax,
  readConfigLiteral,
  readPackageJson,
  toPosixPath,
  type ExtractContext,
  type ListenPort,
} from '@flowatlas/core';
import { ts } from 'ts-morph';

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
 * (P300, P307). A `server` written as a function of the command gives each
 * command its own port (P315): the dev server's for `astro dev`, the
 * preview's for `astro preview`.
 */
export const astroListens = (repoDir: string): ListenPort[] => {
  const { ports } = configuredPorts(repoDir, ASTRO_CONFIGS, ['server']);
  const scripts = scriptCommands(repoDir, /\bastro\s+(?:dev|preview)\b/);
  const config = readConfigLiteral(repoDir, ASTRO_CONFIGS);
  const server = config === undefined ? undefined : configValueAt(config.value, 'server');
  // `server: ({ command }) => ({ port })`: the port of each command (P315).
  const perCommand = config !== undefined && server instanceof NotLiteral ? astroServerOfCommand(server.text, config.file, repoDir) : undefined;
  const found: ListenPort[] = perCommand === undefined ? [...ports.values()] : [];
  // A `server` written as something not read may set the port: no default.
  const serverUnread =
    config !== undefined && perCommand === undefined && (server instanceof NotLiteral || configValueAt(config.value, 'server.port') instanceof NotLiteral);
  if (serverUnread && ports.size === 0) return found.concat(scripts.flatMap((each) => (each.port === undefined ? [] : [{ port: each.port, file: 'package.json', line: each.line, devServer: true as const }])));
  for (const command of ['dev', 'preview'] as const) {
    const commands = scripts.filter((each) => /\bastro\s+preview\b/.test(each.command) === (command === 'preview'));
    const written = commands.filter((each) => each.port !== undefined);
    for (const each of written) found.push({ port: each.port as number, file: 'package.json', line: each.line, devServer: true });
    // The dev server's port is kept as a configuration's `server.port` is; the preview's where a script serves it.
    const configured = perCommand?.get(command);
    if (configured !== undefined && (command === 'dev' || commands.length > 0)) found.push(configured);
    const said = perCommand === undefined ? ports.size > 0 : configured !== undefined;
    if (said || written.length > 0 || commands.length === 0 || commands.some((each) => each.portUnread === true)) continue;
    found.push({ port: ASTRO_DEFAULT, file: 'package.json', line: (commands[0] as ScriptCommand).line, default: true, devServer: true });
  }
  return found;
};

type AstroCommand = 'dev' | 'preview';

/**
 * Astro's `server` written as a function of the command it runs for (P315):
 * `server: ({ command }) => ({ port: command === 'dev' ? 4000 : 8080 })`,
 * which Astro calls with `command` `'dev'` for `astro dev` and `'preview'`
 * for `astro preview`. The function's object is read for each command, a
 * condition on the command settled by it; a port written as a setting with a
 * fallback is read as a configuration's is. Undefined where the function is
 * not one this reads (a body that does more than return an object, a
 * condition on something else), so that nothing is assumed in its place.
 */
const astroServerOfCommand = (text: string, file: string, repoDir: string): Map<AstroCommand, ListenPort> | undefined => {
  const syntax = parseSyntax(`const server = (${text});`, 'server.ts');
  const statement = syntax.statements[0];
  const declared = statement !== undefined && ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.initializer : undefined;
  const fn = declared === undefined ? undefined : unwrapTs(declared);
  if (fn === undefined || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return undefined;
  // What the command is called inside: `{ command }`, `{ command: cmd }`, or `options.command`.
  const parameter = fn.parameters[0];
  let commandName: string | undefined;
  if (parameter !== undefined && ts.isObjectBindingPattern(parameter.name)) {
    const element = parameter.name.elements.find((each) => (each.propertyName ?? each.name).getText(syntax) === 'command');
    commandName = element === undefined ? undefined : element.name.getText(syntax);
  } else if (parameter !== undefined && ts.isIdentifier(parameter.name)) {
    commandName = `${parameter.name.text}.command`;
  }
  let body: ts.Expression | undefined;
  if (ts.isBlock(fn.body)) {
    const statements = fn.body.statements;
    const returned = statements.length === 1 ? statements[0] : undefined;
    body = returned !== undefined && ts.isReturnStatement(returned) ? returned.expression : undefined;
  } else {
    body = fn.body;
  }
  const object = body === undefined ? undefined : unwrapTs(body);
  if (object === undefined || !ts.isObjectLiteralExpression(object)) return undefined;
  const property = object.properties.find((each) => ts.isPropertyAssignment(each) && each.name.getText(syntax) === 'port');
  const out = new Map<AstroCommand, ListenPort>();
  if (property === undefined || !ts.isPropertyAssignment(property)) return out;
  let configText = '';
  try {
    configText = readFileSync(file, 'utf8');
  } catch {
    // The line falls back to the first.
  }
  const at = /\bserver\s*:[\s\S]*?\bport\s*:/.exec(configText);
  const line = at === null ? 1 : configText.slice(0, at.index + at[0].length).split('\n').length;
  const where = toPosixPath(relative(repoDir, file));
  for (const command of ['dev', 'preview'] as const) {
    const value = valueForCommand(property.initializer, command, commandName, syntax);
    if (value === 'unread') return undefined;
    if (value !== undefined) out.set(command, { ...value, file: where, line, devServer: true });
  }
  return out;
};

/** An expression under parentheses, `as` and `satisfies`. */
const unwrapTs = (node: ts.Expression): ts.Expression => {
  let at = node;
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at)) at = at.expression;
  return at;
};

/** Whether a condition on the command holds for one: `command === 'dev'`, `command !== 'preview'`, `!(…)`; undefined where it is on something else. */
const holdsFor = (node: ts.Expression, command: AstroCommand, commandName: string | undefined, syntax: ts.SourceFile): boolean | undefined => {
  const at = unwrapTs(node);
  if (ts.isPrefixUnaryExpression(at) && at.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = holdsFor(at.operand, command, commandName, syntax);
    return inner === undefined ? undefined : !inner;
  }
  if (!ts.isBinaryExpression(at) || commandName === undefined) return undefined;
  const operator = at.operatorToken.kind;
  const equal = operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.EqualsEqualsToken;
  const unequal = operator === ts.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsToken;
  if (!equal && !unequal) return undefined;
  const [named, literal] = at.left.getText(syntax) === commandName ? [at.left, at.right] : [at.right, at.left];
  if (named.getText(syntax) !== commandName || !(ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal))) return undefined;
  return (literal.text === command) === equal;
};

/** The port an expression gives for one command, `'unread'` where a condition it turns on is not on the command. */
const valueForCommand = (
  node: ts.Expression,
  command: AstroCommand,
  commandName: string | undefined,
  syntax: ts.SourceFile,
): Pick<ListenPort, 'port' | 'setting'> | 'unread' | undefined => {
  const at = unwrapTs(node);
  if (ts.isConditionalExpression(at)) {
    const holds = holdsFor(at.condition, command, commandName, syntax);
    if (holds === undefined) return 'unread';
    return valueForCommand(holds ? at.whenTrue : at.whenFalse, command, commandName, syntax);
  }
  if (ts.isNumericLiteral(at)) return configPort(Number(at.text));
  if (ts.isStringLiteral(at) || ts.isNoSubstitutionTemplateLiteral(at)) return configPort(at.text);
  if (at.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(at) && at.text === 'undefined')) return undefined;
  return configPort(new NotLiteral(at.getText(syntax))) ?? 'unread';
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
 * Create React App's development server, `react-scripts start` (or CRACO's
 * `craco start`, which runs it): it loads `.env.development.local`,
 * `.env.local`, `.env.development` and `.env` before it starts, and listens
 * on `PORT` (P315). A port a script gives (`PORT=3005 react-scripts start`)
 * or a loaded file sets is where it listens; where neither says, nothing is
 * assumed, since it offers the next free port when 3000 is taken, as Vite's
 * dev server takes one.
 */
const CRA_ENV: EnvLoading = {
  commands: /\b(?:react-scripts|craco)\s+start\b/,
  files: ['.env.development.local', '.env.local', '.env.development', '.env'],
  settings: ['PORT'],
};

/** Where Create React App's development server listens, where a script or a file it loads says (P315). */
export const createReactAppListens = (repoDir: string): ListenPort[] => {
  const scripts = scriptCommands(repoDir, CRA_ENV.commands);
  if (scripts.length === 0) return [];
  const given = scripts.flatMap((each) => {
    const port = each.environmentPort ?? each.port;
    return port === undefined ? [] : [{ port, file: 'package.json', line: each.line, devServer: true as const }];
  });
  if (given.length > 0 || scripts.some((each) => each.portUnread === true)) return given;
  const filed = envFilePort(repoDir, scripts, CRA_ENV);
  return filed === undefined ? [] : [{ ...filed, devServer: true }];
};

/** Gatsby's own ports, for `gatsby develop` and for `gatsby serve`, where nothing writes one (P321). */
const GATSBY_DEFAULT = { develop: 8000, serve: 9000 } as const;

/**
 * The environment files a Gatsby site keeps, the one whose value wins first:
 * Gatsby loads them into the site's browser code and its functions (P321).
 */
const GATSBY_ENV: EnvLoading = { commands: /\bgatsby\s+develop\b/, files: ['.env.development', '.env'], settings: ['PORT'] };

/**
 * Gatsby's development server, `gatsby develop`, and the server of a built
 * site, `gatsby serve` (P321): a script's `-p` / `--port`, and for `develop`
 * the `PORT` its command's environment gives; where neither says, Gatsby's
 * own 8000 and 9000, as defaults - each moves to another port when its own is
 * taken. Gatsby loads `.env.development` into the site's browser code and its
 * functions, and its documentation has the site's own configuration load it
 * into Node's, after the command has chosen its port; so a `PORT` that file
 * sets is not taken as where it listens, the default is kept as a guess, and
 * an info `listen-port-guessed` row names the file and the port it sets.
 */
export const gatsbyListens = (ctx: ExtractContext): ListenPort[] => {
  const scripts = scriptCommands(ctx.repoDir, /\bgatsby\s+(?:develop|serve)\b/);
  const found: ListenPort[] = [];
  for (const command of ['develop', 'serve'] as const) {
    const commands = scripts.filter((each) => new RegExp(`\\bgatsby\\s+${command}\\b`).test(each.command));
    const given = commands.flatMap((each) => {
      const port = each.port ?? (command === 'develop' ? each.environmentPort : undefined);
      return port === undefined ? [] : [{ port, file: 'package.json', line: each.line, devServer: true as const }];
    });
    found.push(...given);
    const first = commands[0];
    if (first === undefined || given.length > 0 || commands.some((each) => each.portUnread === true)) continue;
    found.push({ port: GATSBY_DEFAULT[command], file: 'package.json', line: first.line, ...(command === 'develop' ? { setting: 'PORT' } : {}), default: true, devServer: true });
    if (command !== 'develop') continue;
    // A committed file the site keeps that sets PORT: not loaded before the port is chosen, so said, not taken.
    const filed = envFilePort(ctx.repoDir, commands, GATSBY_ENV);
    if (filed === undefined || filed.default === true || filed.port === undefined) continue;
    ctx.builder.addUnresolved({
      file: 'package.json',
      line: first.line,
      reason: 'listen-port-guessed',
      level: 'info',
      message: `${first.command} is read listening on Gatsby's own ${GATSBY_DEFAULT.develop}, a guess: ${filed.file} sets ${filed.setting ?? 'PORT'}=${filed.port} (line ${filed.line}), but Gatsby loads that file into the site's code and functions, not before the command chooses its port.`,
      hint: `Give the port on the command (gatsby develop -p ${filed.port}, or PORT=${filed.port} before it), where it is read; or export the setting in the shell that starts the server.`,
      symbol: first.command,
    });
  }
  return found;
};

/**
 * Where a React, Vue or Svelte front end's own servers listen: its bundler's
 * configuration and scripts, and the dev server targets a workspace tool's
 * `project.json` runs it by (P257).
 */
export const frontEndListens = (ctx: ExtractContext): ListenPort[] => [
  ...viteListens(ctx.repoDir),
  ...astroListens(ctx.repoDir),
  ...appServerListens(ctx.repoDir),
  ...createReactAppListens(ctx.repoDir),
  ...gatsbyListens(ctx),
  ...targetPorts(ctx.repoDir, VITE_SERVER_EXECUTORS, true),
  ...targetPorts(ctx.repoDir, WEBPACK_SERVER_EXECUTORS, true),
];
