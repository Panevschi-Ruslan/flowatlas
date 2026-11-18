import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  NotLiteral,
  configValueAt,
  isEnvironmentName,
  isTestFile,
  listenAt,
  listenCallsIn,
  listensIn,
  normalizeFilePath,
  parseSyntax,
  placedPort,
  portIn,
  portUnreadRow,
  readConfigLiteral,
  type ExtractContext,
  type ListenAt,
  type ListenPort,
  type PortUnread,
} from '@flowatlas/core';
import { Node, SyntaxKind, ts, type SourceFile } from 'ts-morph';
import { isPackageSpecifier, packageDirOf, packageFileOf, packageOfSpecifier } from './installed-packages.js';
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
export const listensByCall = (ctx: ExtractContext): ListenPort[] => {
  const files = loadedEnvFiles(ctx);
  return listenCallsIn(repoSources(ctx), settingsReading(ctx), (unread) => ctx.builder.addUnresolved(portUnreadRow(unread, ctx.repoDir)))
    .map((port) => placedPort(port, ctx.repoDir))
    .map((port) => filledFromEnv(port, ctx.repoDir, files));
};

/**
 * The environment files a service's own code or its scripts load before its
 * server listens, the one whose value wins first (P315). A server reading
 * `process.env.PORT` listens where such a file sets `PORT`, whatever its
 * fallback; one whose code loads nothing keeps its fallback, whatever its
 * `.env` says, since nothing puts the file in its environment.
 *
 * What loads a file, as each tool documents it: dotenv
 * (`import 'dotenv/config'`, `dotenv.config({ path })`), NestJS's
 * `ConfigModule.forRoot({ envFilePath })` (`.env` unless `ignoreEnvFile`),
 * Node's own `process.loadEnvFile(path)` and `--env-file`, Deno's
 * `--env-file`, the `dotenv` and `env-cmd` commands a script runs a server
 * with, and Bun, which loads its files before it runs a file. A path given as
 * anything but a literal names no file this reads.
 *
 * Which file wins where several set one value is each loader's own order
 * (P321). Neither dotenv nor Node overwrites a value the environment already
 * holds, so what a script's command or the runtime loads before the code runs
 * wins over what the code loads, and dotenv's `override: true` wins over
 * both. Within one loader: dotenv (`path: [a, b]`), dotenv-cli (`-e a -e b`,
 * and `-c`'s cascade, `.env.<mode>.local`, `.env.local`, `.env.<mode>`, `.env`)
 * and `ConfigModule`'s `envFilePath` keep the first file's value; Node's and
 * Deno's repeated `--env-file`, and dotenv's with `override`, the last one's;
 * Node's `process.loadEnvFile(a)` called again with `b` keeps `a`'s, each
 * call setting only what the environment does not hold yet (P327);
 * Bun's as {@link bunEnvFiles} says, for the `bun <file>` a script runs, by
 * the `NODE_ENV` and `--env-file` of that command (P348); a server the code
 * starts with `Bun.serve` that no script runs is taken to be started with a
 * bare `bun <file>`.
 */
export const loadedEnvFiles = (ctx: ExtractContext): string[] => {
  // The files a `dotenv.config({ override: true })` loads, the ones before the code runs, the code's own.
  const overriding: string[] = [];
  const before: string[] = [];
  const code: string[] = [];
  const add = (into: string[], named: readonly string[] | undefined, otherwise: readonly string[]): void => {
    for (const file of named ?? otherwise) into.push(file.replace(/^\.\//, ''));
  };
  // Whether the code starts a server with `Bun.serve`, and whether a script runs a file with `bun`.
  let servesWithBun = false;
  let runByBun = false;
  for (const sourceFile of repoSources(ctx)) {
    if (isTestFile(normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir))) continue;
    const text = sourceFile.getFullText();
    if (/\bBun\.serve\s*\(/.test(text)) servesWithBun = true;
    if (!/dotenv|loadEnvFile|ConfigModule/.test(text)) continue;
    if (sourceFile.getImportDeclarations().some((each) => each.getModuleSpecifierValue() === 'dotenv/config')) add(code, undefined, ['.env']);
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      const first = call.getArguments()[0];
      const literal = first !== undefined && (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)) ? first.getLiteralValue() : undefined;
      if (callee.getText() === 'require' && literal === 'dotenv/config') add(code, undefined, ['.env']);
      else if (isLoadEnvFile(callee, sourceFile)) {
        // `process.loadEnvFile()` loads `.env`; a path not written as a literal names no file read.
        // Each call sets only what the environment does not hold yet, so of
        // several calls the first file's value wins (P327, Node's documentation).
        if (first === undefined) add(code, undefined, ['.env']);
        else if (literal !== undefined) add(code, [literal], []);
      } else if (isDotenvConfig(call, sourceFile)) {
        const named = hasOption(first, 'path') ? (pathsOption(first, 'path') ?? []) : undefined;
        // With `override`, each file is laid over what is there, so the last one wins, and over the environment.
        if (isTrueOption(first, 'override')) overriding.unshift(...[...(named ?? ['.env'])].reverse().map((file) => file.replace(/^\.\//, '')));
        else add(code, named, ['.env']);
      } else if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'forRoot' && callee.getExpression().getText() === 'ConfigModule' && importOf(sourceFile, 'ConfigModule') === '@nestjs/config') {
        if (isTrueOption(first, 'ignoreEnvFile')) continue;
        add(code, hasOption(first, 'envFilePath') ? (pathsOption(first, 'envFilePath') ?? []) : undefined, ['.env']);
      }
    }
  }
  for (const each of scriptCommands(ctx.repoDir, SCRIPT_LOADS_ENV)) {
    if (/\b(?:jest|vitest|mocha|playwright|cypress)\b/.test(each.command)) continue;
    const command = each.command;
    const bun = BUN_RUNS_FILE.test(command);
    // Node's, Deno's and Bun's `--env-file`, repeated: the last one wins, and
    // of Bun's `--env-file=a,b` the last one too (it loads them from the end).
    const flagged: string[] = [];
    for (const match of command.matchAll(/(?:^|\s)--env-file(?:-if-exists)?(?:=(\S+)|\s+(\S+))?/g)) {
      const value = match[1] ?? match[2];
      const named = value === undefined || value.startsWith('-') || /\.[cm]?[jt]sx?$/.test(value) ? undefined : bun ? value.split(',').filter((file) => file !== '') : [value];
      add(flagged, named, ['.env']);
    }
    before.push(...flagged.reverse());
    if (/(?:^|\s)dotenv(?:-cli)?\s/.test(command)) {
      const named = [...command.matchAll(/(?:^|\s)-e\s+(\S+)/g)].map((match) => match[1] as string);
      add(before, dotenvCliFiles(named.length === 0 ? ['.env'] : named, command), []);
    }
    if (/(?:^|\s)env-cmd\s/.test(command)) {
      const named = /(?:^|\s)(?:-f|--file)\s+(\S+)/.exec(command)?.[1];
      add(before, named === undefined ? undefined : [named], ['.env']);
    }
    if (bun) {
      runByBun = true;
      // `--env-file` replaces Bun's own files, and `--no-env-file` drops them.
      const mode = /(?:^|\s)BUN_ENV=['"]?(\w+)/.exec(command)?.[1] ?? /(?:^|\s)NODE_ENV=['"]?(\w+)/.exec(command)?.[1];
      if (flagged.length === 0 && !/(?:^|\s)--no-env-file\b/.test(command)) add(before, undefined, bunEnvFiles(mode));
    }
  }
  // A server `Bun.serve` starts that no script runs: Bun's own files, as a bare `bun <file>` loads them.
  if (servesWithBun && !runByBun) add(before, undefined, bunEnvFiles());
  return [...new Set([...overriding, ...before, ...code].map((file) => file.replace(/^['"]|['"]$/g, '')))];
};

/** The script commands that load an environment file before what they run (P315). */
const SCRIPT_LOADS_ENV = /--env-file|(?:^|\s)dotenv(?:-cli)?\s|(?:^|\s)env-cmd\s|(?:^|\s)bun\s/;

/** A command that runs a file with Bun, its flags (`--watch`, `--env-file .env.ci`) before the file (P348). */
const BUN_RUNS_FILE = /(?:^|\s)bun\s+(?:run\s+)?(?:--?[\w-]+(?:=\S+|\s+[^\s-]\S*)?\s+)*[\w./-]+\.[cm]?[jt]sx?(?:\s|$)/;

/**
 * The files Bun loads before it runs a file, the one whose value wins first
 * (P315, P321, P348), as its documentation lists them and its loader reads
 * them (https://bun.com/docs/runtime/environment-variables): `.env.<mode>.local`,
 * `.env.local` (not where the mode is `test`), `.env.<mode>` and `.env`, each
 * later file setting only what an earlier one left unset. The mode is
 * `production` or `test` where `BUN_ENV`, else `NODE_ENV`, says so, and
 * `development` for any other value or none: Bun knows no other.
 */
export const bunEnvFiles = (nodeEnv?: string): readonly string[] => {
  const mode = nodeEnv === 'production' || nodeEnv === 'test' ? nodeEnv : 'development';
  return [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env'];
};

/**
 * The files the dotenv-cli command loads, the one whose value wins first
 * (P321): each `-e` file in order, and with `-c` its cascade - `.env.<mode>.local`,
 * `.env.local`, `.env.<mode>`, `.env` for `-c <mode>`, `.env.local` and `.env`
 * for a bare `-c`.
 */
const dotenvCliFiles = (named: readonly string[], command: string): string[] => {
  const cascade = /(?:^|\s)-c(?:\s+(?!--)([^-\s]\S*))?(?=\s|$)/.exec(command);
  if (cascade === null) return [...named];
  const mode = cascade[1];
  return named.flatMap((file) => (mode === undefined ? [`${file}.local`, file] : [`${file}.${mode}.local`, `${file}.local`, `${file}.${mode}`, file]));
};

/**
 * Whether a callee is Node's `process.loadEnvFile`: written so, or
 * `loadEnvFile` imported from `node:process` (P327).
 */
const isLoadEnvFile = (callee: Node, sourceFile: SourceFile): boolean => {
  if (callee.getText() === 'process.loadEnvFile') return true;
  if (!Node.isIdentifier(callee)) return false;
  const from = importOf(sourceFile, callee.getText());
  if (from !== 'node:process' && from !== 'process') return false;
  // `import { loadEnvFile as load } from 'node:process'`: the name imported, whatever it is called here.
  return sourceFile
    .getImportDeclarations()
    .some((each) => each.getModuleSpecifierValue() === from && each.getNamedImports().some((named) => named.getName() === 'loadEnvFile' && (named.getAliasNode() ?? named.getNameNode()).getText() === callee.getText()));
};

/** Whether an options object writes a key as `true`. */
const isTrueOption = (options: Node | undefined, key: string): boolean => {
  if (options === undefined || !Node.isObjectLiteralExpression(options)) return false;
  const property = options.getProperty(key);
  return property !== undefined && Node.isPropertyAssignment(property) && property.getInitializer()?.getText() === 'true';
};

/** Whether a call is dotenv's `config`: `dotenv.config()`, `config()` imported from it, `require('dotenv').config()`. */
const isDotenvConfig = (call: Node, sourceFile: SourceFile): boolean => {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText() === 'config' && importOf(sourceFile, 'config') === 'dotenv';
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'config') return false;
  const owner = callee.getExpression();
  if (owner.getText() === "require('dotenv')" || owner.getText() === 'require("dotenv")') return true;
  if (!Node.isIdentifier(owner)) return false;
  const name = owner.getText();
  return (
    importOf(sourceFile, name) === 'dotenv' ||
    sourceFile.getImportDeclarations().some((each) => each.getModuleSpecifierValue() === 'dotenv' && each.getNamespaceImport()?.getText() === name)
  );
};

/** Whether an options object writes a key at all. */
const hasOption = (options: Node | undefined, key: string): boolean =>
  options !== undefined && Node.isObjectLiteralExpression(options) && options.getProperty(key) !== undefined;

/** The files an option names as literals, `path: '.env.local'` or `envFilePath: ['.env.local', '.env']`, or nothing. */
const pathsOption = (options: Node | undefined, key: string): string[] | undefined => {
  if (options === undefined || !Node.isObjectLiteralExpression(options)) return undefined;
  const property = options.getProperty(key);
  const value = property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  const text = (node: Node): string | undefined => (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralValue() : undefined);
  if (value === undefined) return undefined;
  if (Node.isArrayLiteralExpression(value)) {
    const files = value.getElements().map(text);
    return files.every((file) => file !== undefined) ? (files as string[]) : undefined;
  }
  const file = text(value);
  return file === undefined ? undefined : [file];
};

/**
 * A port the code reads from a setting, where an environment file the
 * service loads before it listens sets that setting (P315): the file's
 * number, `valueFrom` it, in place of the code's fallback. The first loaded
 * file that is committed and writes the setting as a number gives it.
 */
export const filledFromEnv = (port: ListenPort, repoDir: string, files: readonly string[], settings?: readonly string[]): ListenPort => {
  const asked = settings ?? (port.setting !== undefined && isEnvironmentName(port.setting) ? [port.setting] : []);
  if (asked.length === 0 || port.valueFrom !== undefined || files.length === 0) return port;
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(repoDir, file), 'utf8');
    } catch {
      continue;
    }
    const found = portInEnvFile(text, asked);
    if (found === undefined) continue;
    const { default: _default, ...rest } = port;
    return { ...rest, port: found.port, setting: found.setting, valueFrom: file };
  }
  return port;
};

/** Where a runtime's or a library's own server function starts, and the port it listens on when none is written. */
interface ServeShape {
  /** Whether a call starts one. */
  readonly starts: (callee: Node, sourceFile: SourceFile) => boolean;
  /** The argument holding the options with the port. */
  readonly optionsAt: number;
  /** The port it listens on where the options write none. */
  readonly otherwise: number;
  /**
   * The settings it takes that port from before its own default (P315): Bun's
   * server listens on `BUN_PORT`, `PORT` or `NODE_PORT`, which a file Bun
   * loads may set - the files {@link loadedEnvFiles} reads for the scripts
   * that run it, by their own `NODE_ENV` and `--env-file` (P348).
   */
  readonly fromEnv?: { readonly settings: readonly string[] };
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
  {
    starts: (callee) => callee.getText() === 'Bun.serve',
    optionsAt: 0,
    otherwise: 3000,
    fromEnv: { settings: ['BUN_PORT', 'PORT', 'NODE_PORT'] },
  },
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
  const files = loadedEnvFiles(ctx);
  const found: ListenAt[] = [];
  // A runtime's own default, moved by the environment file the runtime loads (P315).
  const runtimeDefaults: ListenPort[] = [];
  const reading = settingsReading(ctx);
  const unread = (each: PortUnread): void => void ctx.builder.addUnresolved(portUnreadRow(each, ctx.repoDir));
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
        if (read === undefined) continue;
        if (shape.fromEnv === undefined) found.push(read);
        else runtimeDefaults.push(filledFromEnv(placedPort(read, ctx.repoDir), ctx.repoDir, files, shape.fromEnv.settings));
        continue;
      }
      found.push(...listensIn(options, call, { reading, unread }));
    }
    const exported = exportedServerIn(sourceFile);
    if (exported !== undefined) found.push(exported);
  }
  return [...listensByCall(ctx), ...found.map((port) => filledFromEnv(placedPort(port, ctx.repoDir), ctx.repoDir, files)), ...runtimeDefaults];
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
  /**
   * Every number the command's own environment gives a setting (P321):
   * `FASTIFY_PORT=3020 fastify start`, `PORT=3020 gatsby develop`, for a
   * framework that reads its port from a setting of another name.
   */
  readonly environment?: Readonly<Record<string, number>>;
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
      const environment: Record<string, number> = {};
      for (const match of part.matchAll(/(?:^|\s)([A-Z][A-Z0-9_]*)=['"]?(\d{2,5})['"]?(?=\s)/g)) {
        if (Number(match[2]) < 65536) environment[match[1] as string] ??= Number(match[2]);
      }
      const handed = port === undefined && environmentPort === undefined && /(?:^|\s)(?:-p|--port)(?:\s+|=)\S/.test(part);
      const at = text.indexOf(JSON.stringify(name));
      found.push({
        command: part.trim(),
        line: at < 0 ? 1 : lineAt(text, at),
        ...(port === undefined ? {} : { port }),
        strict: /(?:^|\s)--strict-?port\b/i.test(part),
        ...(environmentPort === undefined ? {} : { environmentPort }),
        ...(handed ? { portUnread: true as const } : {}),
        ...(Object.keys(environment).length === 0 ? {} : { environment }),
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
export const frameworkListens = (
  repoDir: string,
  commands: RegExp,
  otherwise: number,
  written: readonly ListenPort[] = [],
  loads?: EnvLoading,
): ListenPort[] => {
  const scripts = scriptCommands(repoDir, commands);
  const found: ListenPort[] = [...written];
  for (const each of scripts) {
    if (each.port !== undefined) {
      found.push({ port: each.port, file: 'package.json', line: each.line });
      continue;
    }
    // The setting the framework reads first that the command's own environment
    // gives (P321) - unless a file the command loads gives one the framework
    // reads before it: no variable of the command's holds that one, so the
    // file's value is there and wins (P327).
    const settings = loads?.settings ?? [];
    const at = settings.findIndex((setting) => each.environment?.[setting] !== undefined);
    const earlier = at <= 0 || loads === undefined ? undefined : envFilePort(repoDir, [each], { ...loads, settings: settings.slice(0, at) });
    // The command's own configuration file, read between two settings (P329):
    // a setting before it the command or its file gives wins over it, and it over the rest.
    const configured = loads?.configured;
    const slot = configured === undefined ? -1 : settings.indexOf(configured.before);
    if (loads !== undefined && configured !== undefined && slot >= 0 && (at < 0 || at >= slot)) {
      const before = slot === 0 ? undefined : envFilePort(repoDir, [each], { ...loads, settings: settings.slice(0, slot) });
      if (before !== undefined && before.default !== true) {
        found.push(before);
        continue;
      }
      const own = configured.port(each);
      if (own !== undefined) {
        found.push(own);
        continue;
      }
    }
    const given = at < 0 ? each.environmentPort : each.environment?.[settings[at] as string];
    if (earlier !== undefined && earlier.default !== true) found.push(earlier);
    else if (given !== undefined) found.push({ port: given, file: 'package.json', line: each.line });
  }
  if (found.length > 0 || scripts.some((each) => each.portUnread === true) || !existsSync(join(repoDir, 'package.json'))) return found;
  const filed = loads === undefined ? undefined : envFilePort(repoDir, scripts, loads);
  if (filed !== undefined) return [filed];
  return [{ port: otherwise, file: 'package.json', line: scripts[0]?.line ?? 1, setting: 'PORT', default: true }];
};

/**
 * Whether a framework's command loads an environment file before its server
 * listens, and which settings it takes its port from (P305). Where it does, a
 * port the file gives one of them is where the server listens instead of the
 * framework's default: Nuxt's and Nitro's dev command loads `.env` and listens
 * on `NUXT_PORT`, `NITRO_PORT` or `PORT`; Remix's classic `remix dev` loads
 * `.env` and starts the application's server with it, which listens on
 * `PORT`. Next decides its port before it loads any file, so a `PORT` in its
 * `.env` moves nothing, and a framework nothing here says about keeps its
 * default. Of the others (P315): Create React App's `react-scripts start`
 * loads its `.env` files and listens on `PORT`; Vite's and Astro's dev
 * servers load `.env` only for the application's own variables and take no
 * port from it; SvelteKit's Node adapter and Remix's and React Router's own
 * servers read `PORT` from the environment they are started in and load no
 * file; a server of the code's own (`app.listen(process.env.PORT ?? 3000)`)
 * listens where the file its code or its script loads says
 * ({@link loadedEnvFiles}).
 */
export interface EnvLoading {
  /** The script commands that load the files: `nuxi dev`. */
  readonly commands: RegExp;
  /** The files they load, the one whose value wins first. */
  readonly files: readonly string[];
  /** The settings the server takes its port from, the one it reads first first. */
  readonly settings: readonly string[];
  /** The option of the command that names another file to load instead: `--dotenv`. */
  readonly fileOption?: string;
  /**
   * A port the command's own configuration file gives, read before the
   * setting `before` and after the ones in front of it (P329): fastify-cli's
   * `--config` file, between `FASTIFY_PORT` and `PORT`.
   */
  readonly configured?: { readonly before: string; readonly port: (each: ScriptCommand) => ListenPort | undefined };
}

/**
 * The files written as a template of `.env`, committed for everybody to copy:
 * their value is only where a developer's `.env` is likely to put the port,
 * so a port read from one is a candidate, kept as weak as a default.
 */
const ENV_EXAMPLES = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.defaults', 'env.example'];

/** The line and the port an environment file gives the first of some settings that it writes as a number. */
const portInEnvFile = (text: string, settings: readonly string[]): { setting: string; port: number; line: number } | undefined => {
  const lines = text.split(/\r?\n/);
  for (const setting of settings) {
    for (const [index, line] of lines.entries()) {
      const match = new RegExp(`^\\s*(?:export\\s+)?${setting}\\s*=\\s*['"]?(\\d{2,5})['"]?\\s*(?:#.*)?$`).exec(line);
      const port = match?.[1] === undefined ? undefined : Number(match[1]);
      if (port !== undefined && port > 0 && port < 65536) return { setting, port, line: index + 1 };
    }
  }
  return undefined;
};

/**
 * Where a framework's server listens by the environment file its command
 * loads before it listens (P305): the port the first loaded file gives one of
 * its settings, `valueFrom` that file. Where no loaded file is committed, the
 * port an example of it gives, as a candidate (`default` kept). Only a number
 * is read, and only for the settings the framework takes its port from: a
 * file's other values are none of this. Nothing where no script runs a command
 * that loads the file.
 */
export const envFilePort = (repoDir: string, scripts: readonly ScriptCommand[], loads: EnvLoading): ListenPort | undefined => {
  const loading = scripts.filter((each) => loads.commands.test(each.command));
  if (loading.length === 0) return undefined;
  const option = loads.fileOption === undefined ? undefined : new RegExp(`(?:^|\\s)${loads.fileOption}(?:\\s+|=)(\\S+)`);
  const named = loading.flatMap((each) => {
    const file = option?.exec(each.command)?.[1];
    return file === undefined ? [] : [file.replace(/^\.\//, '').replace(/^['"]|['"]$/g, '')];
  });
  const loaded = named.length > 0 ? [...new Set(named)] : loads.files;
  const textOf = (file: string): string | undefined => {
    try {
      return readFileSync(join(repoDir, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  let committed = false;
  for (const file of loaded) {
    const text = textOf(file);
    if (text === undefined) continue;
    committed = true;
    const found = portInEnvFile(text, loads.settings);
    if (found !== undefined) return { port: found.port, file, line: found.line, setting: found.setting, valueFrom: file };
  }
  // A committed `.env` that sets no port leaves the default; an example is read only where none is.
  if (committed) return undefined;
  for (const file of ENV_EXAMPLES) {
    const text = textOf(file);
    const found = text === undefined ? undefined : portInEnvFile(text, loads.settings);
    if (found !== undefined) return { port: found.port, file, line: found.line, setting: found.setting, default: true, valueFrom: file };
  }
  return undefined;
};

/** Nuxt's and Nitro's dev command: `.env`, or the file `--dotenv` names, and the port of `NUXT_PORT`, `NITRO_PORT` or `PORT` (P305). */
export const NITRO_ENV: EnvLoading = {
  commands: /\b(nuxi|nuxt|nitro|nitropack)\s+dev\b/,
  files: ['.env'],
  settings: ['NUXT_PORT', 'NITRO_PORT', 'PORT'],
  fileOption: '--dotenv',
};

/** Remix's classic `remix dev`: `.env`, loaded before it starts the application's server on `PORT` (P305). */
export const REMIX_ENV: EnvLoading = { commands: /\bremix\s+dev\b/, files: ['.env'], settings: ['PORT'] };

/**
 * Next's own server, started by a script or by a workspace tool's target
 * (P257), on 3000 where nothing says (P296). Next takes no port from `.env`
 * (P305): it decides it before it loads the file.
 */
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
  return frameworkListens(ctx.repoDir, /\b(nuxi|nuxt|nitro|nitropack)\s+(dev|preview|start)\b/, 3000, found, NITRO_ENV);
};

/**
 * fastify-cli's `fastify start` (P321, checked against its published source
 * in P327): before it reads its options it loads the `.env` of the directory
 * it runs in - with dotenv up to fastify-cli 7, with Node's own
 * `process.loadEnvFile()` from 8 - neither over a variable the environment
 * already holds; it takes its port from `-p` / `--port`, then
 * `FASTIFY_PORT`, then the `port` of a `--config` file, then `PORT`, then
 * 3000.
 */
export const FASTIFY_CLI_ENV: EnvLoading = { commands: /\bfastify\s+start\b/, files: ['.env'], settings: ['FASTIFY_PORT', 'PORT'] };

/**
 * The `port` of the file `fastify start --config <file>` (`-c`) names (P329).
 * fastify-cli loads it with `require` from the directory it runs in (its
 * `requireModule`), and lays the command line over it
 * (`{ ...defaults, ...configFile, ...commandLine }`, the command line taking
 * `FASTIFY_<OPTION>` for an option it does not give), so its `port` is read
 * after `-p` and `FASTIFY_PORT` and before `PORT`. Read where the file is
 * JSON or a module writing `module.exports = { port }` as a literal: a number,
 * or a string of one. A file not read otherwise is said, and the order goes on
 * to `PORT`.
 *
 * Named by a package rather than a file that is there (P335) - `requireModule`
 * requires a name it finds no file at as a module - it is the file that
 * package's `exports` (for `require`) or `main` gives, the package found in
 * the workspace or installed in the repository; one installed nowhere here is
 * said. An ES module or a TypeScript file is what Node's `require` makes of
 * it - its namespace, type annotations stripped - so `export const port =
 * 4000` (or `export { port }`) gives the port, and `exports.port = 4000` in
 * CommonJS; a port written only under `export default` is the namespace's
 * `default.port`, which fastify start does not read, and is said.
 */
const fastifyConfigPort = (ctx: ExtractContext, each: ScriptCommand): ListenPort | undefined => {
  const named = /(?:^|\s)(?:-c|--config)(?:\s+|=)(\S+)/.exec(each.command)?.[1]?.replace(/^['"]|['"]$/g, '').replace(/^\.\//, '');
  if (named === undefined) return undefined;
  const unread = (why: string): undefined => {
    ctx.builder.addUnresolved({
      file: 'package.json',
      line: each.line,
      reason: 'listen-port-unread',
      symbol: named,
      message: `fastify start reads its port from ${named}, the --config file, before PORT; ${why}, so the port is read from what comes after it.`,
      hint: 'Write the configuration as JSON, as module.exports = { port: <number> }, or as export const port = <number>, in the repository.',
      adapter: 'fastify-routes',
    });
    return undefined;
  };
  let path: string;
  if (existsSync(join(ctx.repoDir, named))) path = join(ctx.repoDir, named);
  else if (isPackageSpecifier(named)) {
    const { name, subpath } = packageOfSpecifier(named);
    const pkg = packageDirOf(ctx.repoDir, name);
    if (pkg === undefined) return unread(`it is not a file of the repository, nor is ${name} a package installed in it or of its workspace`);
    const found = packageFileOf(pkg, subpath);
    if (found === undefined) return unread(`the package ${name} has no file ${subpath === '' ? 'its main' : subpath} names`);
    path = found;
  } else return unread('it is not a file of the repository');
  const file = normalizeFilePath(path, ctx.repoDir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return unread('it is not a file of the repository');
  }
  const portOf = (value: unknown): number | undefined => {
    const port = typeof value === 'number' ? value : typeof value === 'string' && /^\d{2,5}$/.test(value) ? Number(value) : undefined;
    return port !== undefined && Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
  };
  const at = /["']?\bport["']?\s*[:=]/.exec(text);
  const line = at === null ? 1 : lineAt(text, at.index);
  let written: unknown;
  if (path.endsWith('.json')) {
    try {
      written = (JSON.parse(text) as { port?: unknown }).port;
    } catch {
      return unread('it is not JSON');
    }
  } else if (/\bmodule\.exports\s*=/.test(text)) {
    written = configValueAt(readConfigLiteral(dirname(path), [basename(path)])?.value, 'port');
  } else {
    const exported = exportedPort(text, path);
    if (exported === 'none') {
      if (/\bexport\s+default\b/.test(text) && configValueAt(readConfigLiteral(dirname(path), [basename(path)])?.value, 'port') !== undefined) {
        return unread("it writes its port under export default, which require hands fastify start as the module's default, not as its port");
      }
      return /\bexport\s+default\b/.test(text) ? undefined : unread('it exports no module.exports value nor a port');
    }
    written = exported;
  }
  if (written === undefined) return undefined;
  const port = portOf(written);
  return port === undefined ? unread('its port is not written as a number') : { port, file, line };
};

/**
 * The `port` a module exports by name, as `require` of it hands it (P335):
 * `export const port = 4000`, `export { port }` or `export { value as port }`
 * of a constant, and CommonJS `exports.port = 4000`. A literal number or a
 * string of digits; `NotLiteral` for a value written as code; `'none'` where
 * no `port` is exported.
 */
const exportedPort = (text: string, path: string): unknown => {
  const file = parseSyntax(text, path);
  const literal = (node: ts.Expression | undefined): unknown => {
    if (node === undefined) return new NotLiteral('');
    let value = node;
    while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
    if (ts.isNumericLiteral(value)) return Number(value.text);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    return new NotLiteral(value.getText(file));
  };
  const constants = new Map<string, ts.Expression | undefined>();
  let found: unknown = 'none';
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      const exported = (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        constants.set(declaration.name.text, declaration.initializer);
        if (exported && declaration.name.text === 'port') found = literal(declaration.initializer);
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== 'port') continue;
        const local = (element.propertyName ?? element.name).text;
        found = constants.has(local) ? literal(constants.get(local)) : new NotLiteral(local);
      }
    } else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = statement.expression.left.getText(file);
      if (left === 'exports.port' || left === 'module.exports.port') found = literal(statement.expression.right);
    }
  }
  return found;
};

/**
 * Where an application fastify-cli starts listens (P321, P329): an
 * application written as a plugin for `fastify start` calls no `listen` of
 * its own, so the script's `-p`, the port its environment or the `.env` it
 * loads gives `FASTIFY_PORT`, its `--config` file's `port`, the port its
 * environment or `.env` gives `PORT`, or fastify-cli's 3000 as a default.
 * Nothing where no script runs `fastify start`.
 */
export const fastifyCliListens = (ctx: ExtractContext): ListenPort[] => {
  if (scriptCommands(ctx.repoDir, FASTIFY_CLI_ENV.commands).length === 0) return [];
  const loads: EnvLoading = { ...FASTIFY_CLI_ENV, configured: { before: 'PORT', port: (each) => fastifyConfigPort(ctx, each) } };
  return frameworkListens(ctx.repoDir, FASTIFY_CLI_ENV.commands, 3000, [], loads);
};

/** The names a Strapi configuration file of one kind may have, the source first. */
const strapiConfigFiles = (dir: string, kind: string): string[] => ['ts', 'js', 'mjs', 'cjs'].map((extension) => `${dir}/${kind}.${extension}`);

/** Strapi's own port, where its configuration gives none (P321). */
const STRAPI_DEFAULT = 1337;

/** The commands that start Strapi's server, and the file `ENV_PATH` on one names in place of `.env`. */
const STRAPI_STARTS = /\bstrapi\s+(?:develop|dev|start)\b/;

/**
 * The environment whose `config/env/<NODE_ENV>` overrides are read, as the
 * build the graph is of (P327), unless the start script sets another (P329);
 * every other environment's port is a note.
 */
const STRAPI_PRODUCTION = 'production';

/**
 * The environment whose overrides a Strapi application's server is read
 * with (P329): `NODE_ENV` as the scripts that run `strapi start` set it
 * (`NODE_ENV=staging strapi start`, `cross-env NODE_ENV=staging strapi
 * start`), production where one sets none or one sets production, else the
 * first one's.
 */
export const strapiEnvironmentOf = (repoDir: string): string => {
  const environments = scriptCommands(repoDir, /\bstrapi\s+start\b/).map((each) => /(?:^|\s)NODE_ENV=['"]?([\w-]+)/.exec(each.command)?.[1] ?? STRAPI_PRODUCTION);
  return environments.length === 0 || environments.includes(STRAPI_PRODUCTION) ? STRAPI_PRODUCTION : (environments[0] as string);
};

/** What one Strapi server configuration writes for the port. */
interface StrapiPort {
  /** The file, repository-relative, and the line of its `port`. */
  readonly file: string;
  readonly line: number;
  /** A number written, a setting read with its fallback, or `unread` for a port written another way. */
  readonly written: { readonly port: number } | { readonly setting: string; readonly fallback?: number } | 'unread';
}

/** The port a Strapi server configuration in a directory writes, or nothing where it has no file or writes no `port`. */
const strapiPortIn = (repoDir: string, dir: string): StrapiPort | undefined => {
  const config = readConfigLiteral(repoDir, strapiConfigFiles(dir, 'server'));
  if (config === undefined) return undefined;
  const written = configValueAt(config.value, 'port');
  if (written === undefined) return undefined;
  let text = '';
  try {
    text = readFileSync(config.file, 'utf8');
  } catch {
    // The line falls back to the first.
  }
  const at = /\bport\s*:/.exec(text);
  const file = normalizeFilePath(config.file, repoDir);
  const line = at === null ? 1 : lineAt(text, at.index);
  if (typeof written === 'number') return { file, line, written: Number.isInteger(written) && written > 0 && written < 65536 ? { port: written } : 'unread' };
  const read = written instanceof NotLiteral ? /\benv(?:\.int)?\(\s*['"]([A-Za-z_]\w*)['"](?:\s*,\s*['"]?(\d{2,5})['"]?)?\s*\)/.exec(written.text) : null;
  if (read === null) return { file, line, written: 'unread' };
  const fallback = read[2] === undefined || Number(read[2]) >= 65536 ? undefined : Number(read[2]);
  return { file, line, written: { setting: read[1] as string, ...(fallback === undefined ? {} : { fallback }) } };
};

/** The environments a Strapi application writes overrides for under `config/env`, by directory. */
const strapiEnvironments = (repoDir: string): string[] => {
  try {
    return readdirSync(join(repoDir, 'config', 'env'), { withFileTypes: true })
      .filter((each) => each.isDirectory())
      .map((each) => each.name)
      .sort();
  } catch {
    return [];
  }
};

/**
 * Where a Strapi application's server listens (P321, P327): the `port` of its
 * `config/server.*`, under the `config/env/production/server.*` Strapi
 * merges over it where that environment runs - production being the build
 * the graph is of, or the `NODE_ENV` the scripts that run `strapi start` set
 * (P329) - with `env.int('PORT', 1337)` read as the setting with its
 * fallback, or Strapi's 1337 as a default where no file writes one. Strapi
 * loads `.env` (or the file `ENV_PATH` names) before it reads the
 * configuration, as its documentation says, so a port that file gives the
 * setting is where it listens. A port written in a way not read assumes
 * nothing. Another environment's override that moves the port is an info
 * `framework-environment-differs` row naming it.
 */
export const strapiListens = (ctx: ExtractContext): ListenPort[] => {
  const repoDir = ctx.repoDir;
  const named = scriptCommands(repoDir, STRAPI_STARTS).flatMap((each) => {
    const path = /(?:^|\s)ENV_PATH=(\S+)/.exec(each.command)?.[1];
    return path === undefined ? [] : [path.replace(/^['"]|['"]$/g, '').replace(/^\.\//, '')];
  });
  const files = named.length > 0 ? [...new Set(named)] : ['.env'];
  const base = strapiPortIn(repoDir, 'config');
  const portOf = (written: StrapiPort | undefined): ListenPort | undefined => {
    // Strapi's own server configuration reads `PORT`, else 1337.
    if (written === undefined) return filledFromEnv({ port: STRAPI_DEFAULT, file: 'package.json', line: 1, setting: 'PORT', default: true }, repoDir, files, ['PORT']);
    if (written.written === 'unread') return undefined;
    if ('port' in written.written) return { port: written.written.port, file: written.file, line: written.line };
    const { setting, fallback } = written.written;
    const port: ListenPort =
      fallback === undefined
        ? { port: STRAPI_DEFAULT, file: written.file, line: written.line, setting, default: true }
        : { port: fallback, file: written.file, line: written.line, setting };
    return filledFromEnv(port, repoDir, files, [setting]);
  };
  const atEnvironment = (environment: string): StrapiPort | undefined => strapiPortIn(repoDir, `config/env/${environment}`) ?? base;
  const read = strapiEnvironmentOf(repoDir);
  const chosen = portOf(atEnvironment(read));
  const said = (port: ListenPort | undefined): string => (port === undefined ? 'a port not read' : `${port.port}`);
  const differs = strapiEnvironments(repoDir)
    .filter((environment) => environment !== read && strapiPortIn(repoDir, `config/env/${environment}`) !== undefined)
    .flatMap((environment) => {
      const other = portOf(atEnvironment(environment));
      return said(other) === said(chosen) ? [] : [{ environment, port: said(other), file: atEnvironment(environment)?.file ?? 'package.json' }];
    });
  if (differs.length > 0) {
    ctx.builder.addUnresolved({
      file: differs[0]?.file ?? 'package.json',
      line: 1,
      reason: 'framework-environment-differs',
      level: 'info',
      symbol: differs.map((each) => each.environment).join(', '),
      message: `Strapi's server is read listening on ${said(chosen)}, ${read === STRAPI_PRODUCTION ? "the production build's" : `NODE_ENV=${read}'s, which the start script sets`}; ${differs
        .map((each) => `for ${each.environment}, ${each.file} moves it to ${each.port}`)
        .join('; ')}. Which one runs is NODE_ENV's, development where nothing sets it`,
      hint: "Nothing to do. The graph is the production build's; give every environment the same port to have one answer.",
      adapter: 'strapi-server',
      meta: { cause: 'framework-environment-differs', environments: differs.map((each) => ({ environment: each.environment, port: each.port, file: each.file })) },
    });
  }
  return chosen === undefined ? [] : [chosen];
};
