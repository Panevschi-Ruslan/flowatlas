import { posix } from 'node:path';
import type { FileSystemHost, Project } from 'ts-morph';
import type { DocumentReading } from './documents.js';
import { graphqlFile } from './documents.js';
import type { HandedFragment } from './operations.js';
import type { OperationDefinition } from './parse.js';

/**
 * A `…Document` constant GraphQL Code Generator writes into a module the
 * repository does not commit (P275).
 *
 * `import { RenameTeamDocument } from '~/helpers/backend/graphql'`, where
 * that module is made at install by `graphql-codegen` from the `.graphql`
 * files its configuration's `documents:` lists, is the operation `RenameTeam`
 * of those files: typed-document-node names each document after its
 * operation, the name put in PascalCase (`ToggleSMTP` is `ToggleSmtpDocument`),
 * with or without the operation's type after it (`OrdersQueryDocument`).
 * Read where the module is missing and is either one the configuration
 * generates or is named like a codegen output (`graphql`, `generated`,
 * `gql`); the documents its configuration lists, or every `.graphql` and
 * `.gql` file of the package where none is found. The fragments of every one
 * of those files are handed to the operation, as codegen hands them.
 */

/** The configuration files `graphql-codegen` looks for, and the GraphQL config that may hold it. */
const CONFIG_NAMES = [
  'codegen.yml',
  'codegen.yaml',
  'codegen.json',
  'codegen.ts',
  'codegen.mts',
  'codegen.cts',
  'codegen.js',
  'codegen.mjs',
  'codegen.cjs',
  '.codegenrc',
  '.codegenrc.yml',
  '.codegenrc.yaml',
  '.codegenrc.json',
  '.codegenrc.js',
  '.codegenrc.ts',
  'graphql.config.yml',
  'graphql.config.yaml',
  'graphql.config.json',
  'graphql.config.ts',
  'graphql.config.js',
  '.graphqlrc',
  '.graphqlrc.yml',
  '.graphqlrc.yaml',
  '.graphqlrc.json',
  '.graphqlrc.ts',
  '.graphqlrc.js',
];

/** The last segment of a module a codegen output is commonly named. */
const OUTPUT_NAMED = /(^|[._-])(graphql|gql|generated|__generated__|codegen|operations|sdk)([._-]|$)/i;

/** How many packages up from the importing file a configuration is looked for: its own and the workspaces holding it. */
const PACKAGES_UP = 3;

/** One configuration read: where it is, the documents it lists, and the files it generates. */
interface CodegenConfig {
  readonly dir: string;
  readonly path?: string;
  readonly documents: readonly string[];
  readonly outputs: readonly string[];
}

/** The operations of a set of documents, by their name as codegen names a document. */
interface DocumentIndex {
  readonly operations: ReadonlyMap<string, ReadonlyArray<{ readonly path: string; readonly definition: OperationDefinition }>>;
  readonly fragments: readonly HandedFragment[];
  readonly files: ReadonlyMap<string, Extract<DocumentReading, { kind: 'read' }>>;
  readonly unread: number;
  readonly listed: string;
}

/** The comparable form of a name: letters and digits, lower case, so `ToggleSMTP` and `ToggleSmtp` are one. */
const comparable = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const ROOT_SUFFIX: Readonly<Record<OperationDefinition['operation'], string>> = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' };

const read = (files: FileSystemHost, path: string): string | undefined => {
  try {
    return files.readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
};

/** The strings a value of a configuration holds: a quoted or bare scalar, a `[...]` list, or a YAML list under it. */
const valuesAfter = (text: string, from: number): string[] => {
  const rest = text.slice(from);
  const quoted = (source: string): string[] => [...source.matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1] as string);
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    return quoted(end === -1 ? rest : rest.slice(0, end));
  }
  const line = rest.slice(0, rest.indexOf('\n') === -1 ? undefined : rest.indexOf('\n')).replace(/\s+#.*$/, '').trim();
  if (line !== '') {
    const inQuotes = quoted(line);
    if (inQuotes.length > 0) return [inQuotes[0] as string];
    return [line.replace(/,$/, '')];
  }
  // A YAML list: the `- item` lines indented under the key.
  const listed: string[] = [];
  for (const next of rest.split('\n').slice(1)) {
    if (next.trim() === '') continue;
    const item = /^\s*-\s*(.+?)\s*$/.exec(next);
    if (item === null) break;
    const value = (item[1] as string).replace(/\s+#.*$/, '');
    listed.push(value.replace(/^["']|["']$/g, ''));
  }
  return listed;
};

/** What a configuration lists under every `documents` key, and the paths it generates, read from its text. */
const configOf = (text: string, dir: string, path: string | undefined): CodegenConfig => {
  const documents: string[] = [];
  for (const match of text.matchAll(/["']?\bdocuments["']?\s*:\s*/g)) documents.push(...valuesAfter(text, (match.index ?? 0) + match[0].length));
  const outputs = [...text.matchAll(/^\s*["']?([\w@~.\-/]+(?:\.(?:d\.ts|tsx?|mts|cts|jsx?|mjs|cjs)|\/))["']?\s*:/gm)].map((match) => match[1] as string);
  return { dir, ...(path === undefined ? {} : { path }), documents: documents.filter((glob) => glob !== '' && !glob.startsWith('!')), outputs };
};

/** The configuration file a package's scripts hand `graphql-codegen` with `--config` or `-c`. */
const scriptedConfig = (files: FileSystemHost, dir: string): string | undefined => {
  const manifest = read(files, posix.join(dir, 'package.json'));
  if (manifest === undefined) return undefined;
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(manifest) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return undefined;
  }
  for (const script of Object.values(scripts)) {
    if (typeof script !== 'string' || !/\bgraphql-codegen(-esm)?\b/.test(script)) continue;
    const named = /(?:--config|-c)[=\s]+["']?([^\s"']+)/.exec(script);
    if (named !== null) return named[1];
  }
  return undefined;
};

/** The nearest directory at or above `from` holding a `package.json`. */
const packageDirOf = (files: FileSystemHost, from: string): string => {
  let at = from;
  for (let step = 0; step < 32; step += 1) {
    if (files.fileExistsSync(posix.join(at, 'package.json'))) return at;
    const parent = posix.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return from;
};

/** The configuration a directory holds, read once per file system. */
const configs = new WeakMap<FileSystemHost, Map<string, CodegenConfig | null>>();

const configIn = (files: FileSystemHost, dir: string): CodegenConfig | undefined => {
  const known = configs.get(files)?.get(dir);
  if (known !== undefined) return known ?? undefined;
  let found: CodegenConfig | null = null;
  const scripted = scriptedConfig(files, dir);
  for (const name of scripted === undefined ? CONFIG_NAMES : [scripted, ...CONFIG_NAMES]) {
    const path = posix.join(dir, name);
    const text = read(files, path);
    if (text === undefined) continue;
    const config = configOf(text, dir, path);
    // A GraphQL config that names no documents says nothing about codegen.
    if (config.documents.length > 0 || config.outputs.length > 0) {
      found = config;
      break;
    }
  }
  const byDir = configs.get(files) ?? new Map<string, CodegenConfig | null>();
  byDir.set(dir, found);
  configs.set(files, byDir);
  return found ?? undefined;
};

/**
 * The codegen configuration nearest the importing file: one a package's
 * scripts name, or one of the names codegen looks for, in the package or in
 * the workspaces holding it - up to the third directory with a `package.json`.
 */
const configNear = (files: FileSystemHost, from: string): CodegenConfig | undefined => {
  let at = from;
  let packages = 0;
  for (let step = 0; step < 64 && packages < PACKAGES_UP; step += 1) {
    const config = configIn(files, at);
    if (config !== undefined) return config;
    if (files.fileExistsSync(posix.join(at, 'package.json'))) packages += 1;
    const parent = posix.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return undefined;
};

/** The documents of a set of files, indexed once per file system and listing. */
const indexes = new WeakMap<FileSystemHost, Map<string, DocumentIndex>>();

const indexOf = (files: FileSystemHost, dir: string, globs: readonly string[]): DocumentIndex => {
  const key = `${dir}\0${globs.join('\0')}`;
  const known = indexes.get(files)?.get(key);
  if (known !== undefined) return known;
  const patterns = globs.map((glob) => (glob.startsWith('/') ? glob : posix.join(dir, glob)));
  let paths: string[] = [];
  try {
    paths = files
      .globSync(patterns)
      .map((path) => path.replace(/\\/g, '/'))
      .filter((path) => /\.(graphql|gql|graphqls)$/.test(path) && !path.includes('/node_modules/'));
  } catch {
    paths = [];
  }
  const operations = new Map<string, Array<{ path: string; definition: OperationDefinition }>>();
  const fragments: HandedFragment[] = [];
  const read = new Map<string, Extract<DocumentReading, { kind: 'read' }>>();
  let unread = 0;
  for (const path of [...new Set(paths)].sort()) {
    const file = graphqlFile(files, path, 0);
    if (file?.kind !== 'read') {
      unread += 1;
      continue;
    }
    read.set(path, file);
    for (const definition of file.document.definitions) {
      if (definition.kind === 'fragment') fragments.push({ ...definition, written: file.written });
      if (definition.kind !== 'operation' || definition.name === undefined) continue;
      for (const name of new Set([comparable(definition.name), comparable(`${definition.name}${ROOT_SUFFIX[definition.operation]}`)])) {
        const list = operations.get(name) ?? [];
        list.push({ path, definition });
        operations.set(name, list);
      }
    }
  }
  const index: DocumentIndex = { operations, fragments, files: read, unread, listed: globs.join(', ') };
  const byKey = indexes.get(files) ?? new Map<string, DocumentIndex>();
  byKey.set(key, index);
  indexes.set(files, byKey);
  return index;
};

/** The absolute paths a module specifier may stand for: relative to the importing file, or through the project's `paths`. */
const candidatesOf = (project: Project, importingDir: string, specifier: string): string[] => {
  if (specifier.startsWith('.')) return [posix.join(importingDir, specifier)];
  const options = project.getCompilerOptions();
  const base = options.baseUrl ?? (options.configFilePath === undefined ? undefined : posix.dirname(String(options.configFilePath)));
  const found: string[] = [];
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    const star = pattern.indexOf('*');
    const matches = star === -1 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
    if (!matches || base === undefined) continue;
    const middle = star === -1 ? '' : specifier.slice(star, specifier.length - (pattern.length - star - 1));
    for (const target of targets) found.push(posix.join(base, target.replace('*', middle)));
  }
  return found;
};

const withoutExtension = (path: string): string => path.replace(/\.(d\.ts|tsx?|mts|cts|jsx?|mjs|cjs)$/, '').replace(/\/$/, '');

/** Whether a module a file imports is one the configuration generates. */
const generatedBy = (config: CodegenConfig, candidates: readonly string[]): boolean => {
  const outputs = config.outputs.map((output) => withoutExtension(posix.join(config.dir, output)));
  return candidates.some((candidate) => {
    const bare = withoutExtension(candidate);
    return outputs.some((output) => bare === output || bare === `${output}/index` || `${bare}/index` === output);
  });
};

/**
 * The operation a `…Document` imported from a module nobody committed is,
 * where codegen generates it from documents this can read; undefined where
 * the module is not one codegen makes.
 */
export const codegenDocument = (project: Project, importingFile: string, specifier: string, exported: string): DocumentReading | undefined => {
  const named = /^(.+?)Document$/.exec(exported)?.[1];
  if (named === undefined) return undefined;
  const files = project.getFileSystem();
  const importingDir = posix.dirname(importingFile);
  const config = configNear(files, importingDir);
  const candidates = candidatesOf(project, importingDir, specifier);
  const lastSegment = (specifier.split('/').pop() ?? '').replace(/\.(d\.ts|tsx?|mts|cts|jsx?|mjs|cjs)$/, '');
  const generated = config !== undefined && generatedBy(config, candidates);
  if (!generated && !OUTPUT_NAMED.test(lastSegment)) return undefined;
  const dir = config !== undefined && config.documents.length > 0 ? config.dir : packageDirOf(files, importingDir);
  const globs = config !== undefined && config.documents.length > 0 ? config.documents : ['**/*.graphql', '**/*.gql'];
  const index = indexOf(files, dir, globs);
  const found = index.operations.get(comparable(named)) ?? [];
  const where = config?.path === undefined ? 'the .graphql files of its package' : `the documents ${posix.basename(config.path)} lists (${index.listed})`;
  if (found.length === 0) return { kind: 'dynamic', why: `${exported} is generated by GraphQL codegen into ${specifier}, which is not committed, and no operation named ${named} is in ${where}` };
  if (found.length > 1) return { kind: 'dynamic', why: `${exported} is generated by GraphQL codegen into ${specifier}, and ${found.length} operations of ${where} are named ${named}: ${found.map((each) => each.path).join(', ')}` };
  const [only] = found as [{ path: string; definition: OperationDefinition }];
  const file = index.files.get(only.path) as Extract<DocumentReading, { kind: 'read' }>;
  // Codegen hands an operation every fragment of every document it lists.
  const fragments = [...index.fragments, ...file.fragments];
  return { kind: 'read', document: { definitions: [only.definition] }, text: file.text, written: file.written, fragments, unread: file.unread };
};
