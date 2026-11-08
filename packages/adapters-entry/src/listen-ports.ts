import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  configValueAt,
  isTestFile,
  listenAt,
  listenCallsIn,
  listensIn,
  normalizeFilePath,
  placedPort,
  portIn,
  readConfigLiteral,
  type ExtractContext,
  type ListenAt,
  type ListenPort,
} from '@flowatlas/core';
import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import { settingsReading } from './listen-settings.js';
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

/**
 * Every port the generic `<server>.listen(port)` reading finds in the
 * repository, a settings getter read through the settings libraries the
 * repository builds its settings with (P254).
 */
export const listensByCall = (ctx: ExtractContext): ListenPort[] =>
  listenCallsIn(repoSources(ctx), settingsReading(ctx)).map((port) => placedPort(port, ctx.repoDir));

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
  const reading = settingsReading(ctx);
  for (const sourceFile of repoSources(ctx)) {
    if (isTestFile(normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir))) continue;
    const text = sourceFile.getFullText();
    if (!/\bserve\b/.test(text) && !/\bexport\s+default\s*\{/.test(text)) continue;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const shape = HONO_SERVES.find((each) => each.starts(call.getExpression(), sourceFile));
      if (shape === undefined) continue;
      const options = call.getArguments()[shape.optionsAt];
      // `Deno.serve(handler)` writes no options at all, and options with no
      // `port` leave it to the library; a port written is read where it is,
      // handed in through a function included (P254).
      const written = options !== undefined && Node.isObjectLiteralExpression(options) && options.getProperty('port') !== undefined;
      if (!written) {
        const read = listenAt({ port: shape.otherwise }, call, { default: true });
        if (read !== undefined) found.push(read);
        continue;
      }
      found.push(...listensIn(options, call, { reading }));
    }
    const exported = exportedServerIn(sourceFile);
    if (exported !== undefined) found.push(exported);
  }
  return [...listensByCall(ctx), ...found.map((port) => placedPort(port, ctx.repoDir))];
};

/** The line of a file's text an offset is on. */
const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/** One command of a `package.json` script that starts a server, as far as its port is concerned (P254). */
export interface ScriptCommand {
  /** The command, one part of the script between `&&`, `;` and `|`. */
  readonly command: string;
  /** The line of the script's name in `package.json`. */
  readonly line: number;
  /** The port written on the command: `-p 3020`, `--port 3020`, `--port=3020`. */
  readonly port?: number;
  /** Whether the command says the server must not move to another port where its own is taken: `--strictPort`. */
  readonly strict: boolean;
}

/**
 * The commands of the scripts of a repository's own `package.json` that
 * `commands` matches: `next dev -p 3020`, `vite preview --port 4180`. Only a
 * number written on the command is a port: a script reading `$PORT` is the
 * environment's.
 */
export const scriptCommands = (repoDir: string, commands: RegExp): ScriptCommand[] => {
  let text: string;
  try {
    text = readFileSync(join(repoDir, 'package.json'), 'utf8');
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
  const found: ScriptCommand[] = [];
  for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command !== 'string') continue;
    for (const part of command.split(/&&|\|\||;|\|/)) {
      if (!commands.test(part)) continue;
      const written = /(?:^|\s)(?:-p|--port)(?:\s+|=)(\d{2,5})\b/.exec(part)?.[1];
      const port = written === undefined || Number(written) >= 65536 ? undefined : Number(written);
      const at = text.indexOf(JSON.stringify(name));
      found.push({
        command: part.trim(),
        line: at < 0 ? 1 : lineAt(text, at),
        ...(port === undefined ? {} : { port }),
        strict: /(?:^|\s)--strict-?port\b/i.test(part),
      });
    }
  }
  return found;
};

/**
 * The ports the scripts of the repository's own `package.json` start a
 * framework's server on: `next dev -p 3020`, `nuxi dev --port 3010`,
 * `next start --port=3020`.
 */
export const scriptPorts = (repoDir: string, commands: RegExp): ListenPort[] =>
  scriptCommands(repoDir, commands).flatMap((each) => (each.port === undefined ? [] : [{ port: each.port, file: 'package.json', line: each.line }]));

/** Next's own server, started by a script. */
export const nextListens = (ctx: ExtractContext): ListenPort[] => scriptPorts(ctx.repoDir, /\bnext\s+(dev|start)\b/);

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
  return [...found, ...scriptPorts(ctx.repoDir, /\b(nuxi|nuxt|nitro|nitropack)\s+(dev|preview|start)\b/)];
};
