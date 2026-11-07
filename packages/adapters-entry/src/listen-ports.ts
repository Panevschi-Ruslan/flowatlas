import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  configValueAt,
  isTestFile,
  listenAt,
  listenCallsIn,
  normalizeFilePath,
  placedPort,
  portIn,
  readConfigLiteral,
  type ExtractContext,
  type ListenAt,
  type ListenPort,
} from '@flowatlas/core';
import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import { repoSources } from './shared.js';

/**
 * Where each framework's server listens, as the repository writes it (P250).
 *
 * The line most servers start with is Node's own, `<server>.listen(port)`, and
 * the core reads it for every framework that spells it so - express, koa,
 * fastify, NestJS, `http.createServer(app)`. What is left is each framework's
 * own spelling, kept here beside the adapters that answer for it: Hono's
 * `serve({ fetch, port })` and the runtimes' `Bun.serve` / `Deno.serve`, a
 * module answering `export default { port, fetch }`, Nuxt's `devServer.port`,
 * and the `--port` a `package.json` script starts Next or Nuxt with. No
 * framework's own default dev port is assumed: 3000 is everybody's.
 */

/** Every port the generic `<server>.listen(port)` reading finds in the repository. */
export const listensByCall = (ctx: ExtractContext): ListenPort[] =>
  listenCallsIn(repoSources(ctx)).map((port) => placedPort(port, ctx.repoDir));

/** Where a runtime's or a library's own server function starts, and the port it listens on when none is written. */
interface ServeShape {
  /** Whether a call starts one. */
  readonly starts: (callee: Node, sourceFile: SourceFile) => boolean;
  /** The argument holding the options with the port. */
  readonly optionsAt: number;
  /** The port it listens on where the options write none. */
  readonly otherwise: number;
}

/** The module a name in a file is imported from. */
const importOf = (sourceFile: SourceFile, name: string): string | undefined => {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const named = declaration.getNamedImports().some((each) => (each.getAliasNode() ?? each.getNameNode()).getText() === name);
    if (named || declaration.getDefaultImport()?.getText() === name) return declaration.getModuleSpecifierValue();
  }
  return undefined;
};

/**
 * The server functions a Hono application is started with: `@hono/node-server`'s
 * `serve` (3000 by default), Bun's and Deno's own (3000 and 8000).
 */
const HONO_SERVES: readonly ServeShape[] = [
  {
    starts: (callee, sourceFile) => Node.isIdentifier(callee) && importOf(sourceFile, callee.getText()) === '@hono/node-server',
    optionsAt: 0,
    otherwise: 3000,
  },
  { starts: (callee) => callee.getText() === 'Bun.serve', optionsAt: 0, otherwise: 3000 },
  { starts: (callee) => callee.getText() === 'Deno.serve', optionsAt: 0, otherwise: 8000 },
];

/**
 * A module whose default export is a server's options, `export default { port:
 * 3001, fetch: app.fetch }`, as Bun starts it. Only with the port written: a
 * worker exports `{ fetch }` too, and listens where its own dev server says
 * (P77 reads `dev.port`).
 */
const exportedServerIn = (sourceFile: SourceFile): ListenAt | undefined => {
  const assignment = sourceFile.getExportAssignments().find((each) => !each.isExportEquals());
  const value = assignment?.getExpression();
  if (value === undefined || !Node.isObjectLiteralExpression(value) || value.getProperty('fetch') === undefined) return undefined;
  return listenAt(portIn(value), value);
};

/** Every port a Hono application's server listens on, beside the generic reading. */
export const honoListens = (ctx: ExtractContext): ListenPort[] => {
  const found: ListenAt[] = [];
  for (const sourceFile of repoSources(ctx)) {
    if (isTestFile(normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir))) continue;
    const text = sourceFile.getFullText();
    if (!/\bserve\b/.test(text) && !/\bexport\s+default\s*\{/.test(text)) continue;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const shape = HONO_SERVES.find((each) => each.starts(call.getExpression(), sourceFile));
      if (shape === undefined) continue;
      const options = call.getArguments()[shape.optionsAt];
      // `Deno.serve(handler)` writes no options at all.
      const written = options !== undefined && Node.isObjectLiteralExpression(options) ? portIn(options) : {};
      const read = written.port === undefined && written.setting === undefined ? listenAt({ port: shape.otherwise }, call, { default: true }) : listenAt(written, call);
      if (read !== undefined) found.push(read);
    }
    const exported = exportedServerIn(sourceFile);
    if (exported !== undefined) found.push(exported);
  }
  return [...listensByCall(ctx), ...found.map((port) => placedPort(port, ctx.repoDir))];
};

/** The line of a file's text an offset is on. */
const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/**
 * The ports the scripts of the repository's own `package.json` start a
 * framework's server on: `next dev -p 3020`, `nuxi dev --port 3010`,
 * `next start --port=3020`. Only a number written on the command: a script
 * reading `$PORT` is the environment's.
 */
const scriptPorts = (ctx: ExtractContext, commands: RegExp): ListenPort[] => {
  let text: string;
  try {
    text = readFileSync(join(ctx.repoDir, 'package.json'), 'utf8');
  } catch {
    return [];
  }
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
  } catch {
    return [];
  }
  if (typeof scripts !== 'object' || scripts === null) return [];
  const found: ListenPort[] = [];
  for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command !== 'string') continue;
    for (const part of command.split(/&&|\|\||;|\|/)) {
      if (!commands.test(part)) continue;
      const port = /(?:^|\s)(?:-p|--port)(?:\s+|=)(\d{2,5})\b/.exec(part)?.[1];
      if (port === undefined || Number(port) >= 65536) continue;
      const at = text.indexOf(JSON.stringify(name));
      found.push({ port: Number(port), file: 'package.json', line: at < 0 ? 1 : lineAt(text, at) });
    }
  }
  return found;
};

/** Next's own server, started by a script. */
export const nextListens = (ctx: ExtractContext): ListenPort[] => scriptPorts(ctx, /\bnext\s+(dev|start)\b/);

const NUXT_CONFIGS = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts', 'nuxt.config.cjs'];

/**
 * Nuxt's and Nitro's dev server: `devServer: { port }` in the configuration,
 * read as a literal (P240), and a script's `--port`. Nitro's own configuration
 * names no port.
 */
export const nitroListens = (ctx: ExtractContext): ListenPort[] => {
  const found: ListenPort[] = [];
  const config = readConfigLiteral(ctx.repoDir, NUXT_CONFIGS);
  const port = configValueAt(config?.value, 'devServer.port');
  if (config !== undefined && typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536) {
    const text = readFileSync(config.file, 'utf8');
    const at = /devServer\s*:\s*\{[^}]*?\bport\s*:/.exec(text);
    found.push({ port, file: normalizeFilePath(config.file, ctx.repoDir), line: at === null ? 1 : lineAt(text, at.index + at[0].length) });
  }
  return [...found, ...scriptPorts(ctx, /\b(nuxi|nuxt|nitro|nitropack)\s+(dev|preview|start)\b/)];
};
