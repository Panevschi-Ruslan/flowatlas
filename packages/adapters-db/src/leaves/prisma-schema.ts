import { dirname, join, resolve } from 'node:path';
import type { Project, SourceFile } from 'ts-morph';

/**
 * What a Prisma schema states, read off the schema file rather than off the
 * client generated from it.
 *
 * The generated client is the one thing a clone installed with `--ignore-scripts`
 * never has: `prisma generate` writes it from a postinstall hook, so the checker
 * has no `PrismaClient` to resolve and no delegate type to read (R97). The
 * schema it would have been generated from is in the repository in every state,
 * and it states the two facts a reader of a Prisma call needs from it: where the
 * client is generated to, and what each model is called in the database.
 *
 * Read line by line rather than by a grammar, because the two facts are each a
 * line: a generator's `output`, and a model's `@@map`. A block opens on a line
 * ending in `{` and closes on a line that is `}`, which is how `prisma format`
 * writes every schema, and nothing inside a block is read beyond those lines.
 *
 * What is deliberately not read: a schema split over a `prisma/schema/` folder,
 * and a schema whose path is set under `prisma.schema` in a manifest. Neither
 * is how the repositories this tool is measured on keep theirs, and a reader
 * written for a layout nothing measures is one nothing checks. Where no schema
 * is found the answer is "not stated", which leaves a call's model named as the
 * call writes it.
 */
export interface PrismaSchema {
  /** Absolute directories a client generator writes to. */
  readonly clientOutputs: readonly string[];
  /** Delegate name, as a call writes it, to the table the model is stored in. */
  readonly tables: ReadonlyMap<string, string>;
}

/** Where a schema sits relative to a directory that holds one. */
const SCHEMA_PLACES = ['schema.prisma', join('prisma', 'schema.prisma')];

/**
 * The generators that write the client a call is made through.
 *
 * `prisma-client-js` is the long-standing one and `prisma-client` its successor;
 * every other generator in a schema writes something else - zod schemas, a
 * Kysely type file - and a module under its output is not a client.
 */
const CLIENT_PROVIDERS: ReadonlySet<string> = new Set(['prisma-client-js', 'prisma-client']);

/** How far up from a file a schema is looked for, which is enough for any monorepo. */
const MAX_ASCENT = 16;

/**
 * The name Prisma gives a model's delegate on the client.
 *
 * The model's name with its first character lowered: `model BookingSeat` is
 * `prisma.bookingSeat`. That is the whole of the rule the generator applies, so
 * reading it backwards from the call needs the schema to say which models exist
 * and nothing more.
 */
const delegateOf = (model: string): string => `${model.charAt(0).toLowerCase()}${model.slice(1)}`;

const quoted = (line: string, key: string): string | undefined =>
  new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`).exec(line)?.[1];

/** `@@map("users")` and `@@map(name: "users")` are one statement written two ways. */
const MAPPED = /^\s*@@map\(\s*(?:name\s*:\s*)?"([^"]+)"/;
const OPENS = /^\s*(generator|model)\s+([A-Za-z_]\w*)\s*\{\s*$/;

/** Reads one schema's text. The directory is the schema's own, which `output` is relative to. */
export const parsePrismaSchema = (text: string, schemaDir: string): PrismaSchema => {
  const clientOutputs: string[] = [];
  const tables = new Map<string, string>();
  let block: { kind: string; name: string; provider?: string; output?: string; map?: string } | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (block === undefined) {
      const opened = OPENS.exec(line);
      if (opened !== null) block = { kind: opened[1] ?? '', name: opened[2] ?? '' };
      continue;
    }
    if (/^\s*\}\s*$/.test(line)) {
      if (block.kind === 'model') tables.set(delegateOf(block.name), block.map ?? block.name);
      const { provider, output } = block;
      if (block.kind === 'generator' && provider !== undefined && CLIENT_PROVIDERS.has(provider) && output !== undefined) {
        clientOutputs.push(resolve(schemaDir, output));
      }
      block = undefined;
      continue;
    }
    block.provider ??= quoted(line, 'provider');
    block.output ??= quoted(line, 'output');
    block.map ??= MAPPED.exec(line)?.[1];
  }
  return { clientOutputs, tables };
};

/** Answers already read, per project, so a repository of a thousand calls reads its schema once. */
const found = new WeakMap<Project, Map<string, PrismaSchema | null>>();

/**
 * The schema that governs a file: the nearest one at or above its directory.
 *
 * Asked of the file a client is imported or constructed in, never of the file
 * a call is written in, because that is where the schema belongs: a scheduling app's
 * calls are in `apps/web` and its schema is beside the wrapper in
 * `packages/prisma`. The ascent stops at the checkout, so a schema of some
 * other repository above this one is never read as this one's.
 *
 * Read through the project's own file system, so that what a test holds in
 * memory and what a run reads off disk are read by the one path.
 */
export const prismaSchemaFor = (file: SourceFile): PrismaSchema | undefined => {
  const project = file.getProject();
  const fs = project.getFileSystem();
  let cache = found.get(project);
  if (cache === undefined) {
    cache = new Map();
    found.set(project, cache);
  }
  const visited: string[] = [];
  let dir = dirname(file.getFilePath());
  let answer: PrismaSchema | null = null;
  for (let depth = 0; depth < MAX_ASCENT; depth += 1) {
    const known = cache.get(dir);
    if (known !== undefined) {
      answer = known;
      break;
    }
    visited.push(dir);
    const path = SCHEMA_PLACES.map((place) => join(dir, place)).find((candidate) => fs.fileExistsSync(candidate));
    if (path !== undefined) {
      answer = parsePrismaSchema(fs.readFileSync(path), dirname(path));
      break;
    }
    const parent = dirname(dir);
    if (parent === dir || fs.fileExistsSync(join(dir, '.git')) || fs.directoryExistsSync(join(dir, '.git'))) break;
    dir = parent;
  }
  for (const seen of visited) cache.set(seen, answer);
  return answer ?? undefined;
};

/**
 * Whether a module path lies in the directory a schema generates its client to.
 *
 * `import { PrismaClient } from './generated/prisma/client'` names a file that
 * does not exist until `prisma generate` runs, and the schema beside it says
 * `output = "./generated/prisma"`. That sentence is the evidence: the module is
 * the client because the repository's own schema says it writes the client
 * there, not because anything about it is spelled like one.
 */
export const isGeneratedPrismaClient = (from: SourceFile, target: string): boolean =>
  (prismaSchemaFor(from)?.clientOutputs ?? []).some(
    (output) => target === output || target.startsWith(`${output}/`),
  );

/**
 * The table a model is stored in, by the delegate a call names it with.
 *
 * A model is its own table unless `@@map` says otherwise, which is the rule
 * Prisma applies. Undefined where no schema governs the file or the schema has
 * no such model, and the caller keeps the name the call wrote: what the source
 * states is the delegate, and a guess at the capitalisation of a model nobody
 * can read would be a second name for the same thing.
 */
export const prismaTableOf = (from: SourceFile, delegate: string): string | undefined =>
  prismaSchemaFor(from)?.tables.get(delegate);
