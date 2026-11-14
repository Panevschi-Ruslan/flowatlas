import { existsSync, readFileSync } from 'node:fs';
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
import { NEXT_SERVER_EXECUTORS, targetPorts } from './workspace-targets.js';
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
 * and the `--port` a `package.json` script starts Next or Nuxt with. Where
 * nothing says, a full-stack framework's own default (Next's and Nuxt's 3000)
 * is where it listens (P296), as the weakest word for a port: 3000 is
 * everybody's, so a default yields to any service the code or the files place
 * there, and two defaults on one port are no answer.
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
  /**
   * The port the command's own environment gives a server that reads `PORT`
   * (P296): `PORT=3020 next start`, or the fallback of `-p ${PORT:-3020}`.
   */
  readonly environmentPort?: number;
  /** Whether the command hands the port in from somewhere nothing here reads: `-p $PORT` (P296). */
  readonly portUnread?: true;
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
      // `PORT=3020 next start`, `-p ${PORT:-3020}`: where a server reading PORT listens (P296).
      const given = /(?:^|\s)PORT=(\d{2,5})(?=\s)/.exec(part)?.[1] ?? /\$\{PORT:?-(\d{2,5})\}/.exec(part)?.[1];
      const environmentPort = given === undefined || Number(given) >= 65536 ? undefined : Number(given);
      const handed = port === undefined && environmentPort === undefined && /(?:^|\s)(?:-p|--port)(?:\s+|=)\S/.test(part);
      const at = text.indexOf(JSON.stringify(name));
      found.push({
        command: part.trim(),
        line: at < 0 ? 1 : lineAt(text, at),
        ...(port === undefined ? {} : { port }),
        strict: /(?:^|\s)--strict-?port\b/i.test(part),
        ...(environmentPort === undefined ? {} : { environmentPort }),
        ...(handed ? { portUnread: true as const } : {}),
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

/**
 * Where a full-stack framework's own server listens (P296): the port its
 * configuration writes (`written`), each script's `-p`, and the port a
 * script's own environment gives a server reading `PORT`; and, where none of
 * them says and no script hands the port in from somewhere unread, the
 * framework's documented default, as the setting `PORT` falls back to it
 * (`default: true`). Such a server serves the application's own API routes,
 * so it is no dev server forwarding what it does not serve; a default is the
 * weakest word for a port, and yields to any other (`atLocalPort`).
 */
export const frameworkListens = (repoDir: string, commands: RegExp, otherwise: number, written: readonly ListenPort[] = []): ListenPort[] => {
  const scripts = scriptCommands(repoDir, commands);
  const found: ListenPort[] = [...written];
  for (const each of scripts) {
    if (each.port !== undefined) found.push({ port: each.port, file: 'package.json', line: each.line });
    else if (each.environmentPort !== undefined) found.push({ port: each.environmentPort, file: 'package.json', line: each.line });
  }
  if (found.length > 0 || scripts.some((each) => each.portUnread === true) || !existsSync(join(repoDir, 'package.json'))) return found;
  return [{ port: otherwise, file: 'package.json', line: scripts[0]?.line ?? 1, setting: 'PORT', default: true }];
};

/** Next's own server, started by a script or by a workspace tool's target (P257), on 3000 where nothing says (P296). */
export const nextListens = (ctx: ExtractContext): ListenPort[] =>
  frameworkListens(ctx.repoDir, /\bnext\s+(dev|start)\b/, 3000, targetPorts(ctx.repoDir, NEXT_SERVER_EXECUTORS, false));

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
  // Nuxt's and Nitro's servers listen on 3000 where nothing says (P296).
  return frameworkListens(ctx.repoDir, /\b(nuxi|nuxt|nitro|nitropack)\s+(dev|preview|start)\b/, 3000, found);
};
