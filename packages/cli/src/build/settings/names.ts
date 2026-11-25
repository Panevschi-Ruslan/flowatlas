import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseJsonc, readWorkerToml, type SettingNames } from '@flowatlas/core';
import { parseAllDocuments } from 'yaml';
import { envFileReading, isComposeFile, isExampleEnvFile } from './files.js';

/**
 * Every setting a service's own deployment files give a value, or name for
 * one to be given (P388): what the code's reads of settings are held against,
 * so a key read with no default and set nowhere, a key set and read nowhere,
 * and two names a letter or two apart can be said.
 *
 * Only names, never values: what a production file sets is a secret's
 * business. Read at the repository's top and in the folders deployments are
 * kept in: environment files (examples too: a name an example lists is one
 * the deployment is expected to set), compose files' `environment` and the
 * files their `env_file` names, a Dockerfile's `ENV`, a function framework's
 * `environment`, a worker's `vars`, and a cluster's manifests (`env`, and the
 * keys of the config maps and secrets written beside them; `envFrom` one not
 * written there is said, so the names are known not to be all of them).
 */

/** Folders deployment files are kept in, besides the repository's top. */
const DEPLOY_DIRS = ['deploy', 'deployment', 'deployments', 'k8s', 'kubernetes', 'manifests', 'ops', '.deploy'];

/** A setting's name as environment files write one. */
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const filesIn = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

const textOf = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The names an environment file writes, set or left for whoever copies it to fill in. */
const envNames = (text: string): string[] =>
  text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim().replace(/^export\s+/, '');
    if (trimmed === '' || trimmed.startsWith('#')) return [];
    const equals = trimmed.indexOf('=');
    const name = equals <= 0 ? '' : trimmed.slice(0, equals).trim();
    return NAME.test(name) ? [name] : [];
  });

/** The keys of an `environment` written as a map, or as a list of `NAME=value` and `NAME`. */
const environmentKeys = (value: unknown): string[] => {
  if (isRecord(value)) return Object.keys(value);
  if (Array.isArray(value)) return value.flatMap((item) => (typeof item === 'string' ? [item.split('=')[0]!.trim()] : []));
  return [];
};

/** A Dockerfile's `ENV NAME=value …` and `ENV NAME value`. */
const dockerfileNames = (text: string): string[] =>
  text.split(/\r?\n/).flatMap((line) => {
    const found = /^\s*ENV\s+(.+)$/i.exec(line);
    if (found === null) return [];
    const rest = found[1]!.trim();
    if (!rest.includes('=')) return [rest.split(/\s+/)[0]!];
    return [...rest.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=/g)].map((match) => match[1]!);
  });

/** What a cluster's manifests name: `env[].name`, the keys of config maps and secrets, and whether an `envFrom` reaches one not written. */
const manifestNames = (documents: readonly unknown[]): { names: string[]; envFrom: string[]; held: Set<string> } => {
  const names: string[] = [];
  const envFrom: string[] = [];
  const held = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isRecord(value)) return;
    if (Array.isArray(value['env'])) for (const item of value['env']) if (isRecord(item) && typeof item['name'] === 'string') names.push(item['name']);
    if (Array.isArray(value['envFrom'])) {
      for (const item of value['envFrom']) {
        if (!isRecord(item)) continue;
        const ref = isRecord(item['configMapRef']) ? item['configMapRef'] : isRecord(item['secretRef']) ? item['secretRef'] : undefined;
        if (ref !== undefined && typeof ref['name'] === 'string') envFrom.push(ref['name']);
      }
    }
    for (const child of Object.values(value)) walk(child);
  };
  for (const document of documents) {
    if (!isRecord(document)) continue;
    if ((document['kind'] === 'ConfigMap' || document['kind'] === 'Secret') && isRecord(document['metadata'])) {
      const name = document['metadata']['name'];
      if (typeof name === 'string') held.add(name);
      for (const key of ['data', 'stringData']) if (isRecord(document[key])) names.push(...Object.keys(document[key] as Record<string, unknown>));
      continue;
    }
    walk(document);
  }
  return { names, envFrom, held };
};

/** A configuration module that validates the settings, and may give one a default: where it is written (P388). */
const SCHEMA = /ConfigModule\.forRoot\s*\([\s\S]{0,400}?\b(validationSchema|validate)\s*:/;

/** Source folders a configuration module is looked for in. */
const SOURCE_DIRS = ['src', 'apps', 'libs'];

/** The first source file that validates the settings with a schema, searched a few folders deep. */
const schemaIn = (dir: string): string | undefined => {
  const walk = (at: string, depth: number): string | undefined => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (depth < 4 && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          const found = walk(path, depth + 1);
          if (found !== undefined) return found;
        }
        continue;
      }
      if (!/\.(ts|js|mts)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const text = textOf(path);
      if (text !== undefined && text.includes('ConfigModule') && SCHEMA.test(text)) return relative(dir, path).split(sep).join('/');
    }
    return undefined;
  };
  for (const source of SOURCE_DIRS) {
    const found = walk(join(dir, source), 0);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * A tool that starts a service with its settings handed in from a secret
 * store (P401): what it sets, no file in the checkout names.
 */
const INJECTOR = /\b(doppler run|infisical run|op run|chamber exec|aws-vault exec|envconsul|sops exec-env|dotenvx run|teller run|berglas exec|secrethub run)\b/;

/** An environment file the code loads itself, and the path it names where it names one (P401). */
const ENV_LOADS: ReadonlyArray<{ test: RegExp; path?: RegExp }> = [
  // `import 'dotenv/config'`, `require('dotenv').config({ path })`, `dotenv.config()`, `config({ path })` from dotenv.
  { test: /['"]dotenv\/config['"]/ },
  { test: /\bdotenv['"]\s*\)?\s*\.config\s*\(|\bdotenv\.config\s*\(|from\s+['"]dotenv['"]/, path: /\bpath\s*:\s*['"]([^'"]+)['"]/ },
  { test: /\bprocess\.loadEnvFile\s*\(/, path: /\bprocess\.loadEnvFile\s*\(\s*['"]([^'"]+)['"]/ },
];

/** A NestJS configuration module reading `.env` unless told not to, and the file it is told to read. */
const NEST_CONFIG = /ConfigModule\.forRoot\s*\(([\s\S]{0,400}?)\)/;

/** The first source file a test holds of, a few folders deep, and the text it held of. */
const sourceMatching = (dir: string, test: (text: string) => boolean): { file: string; text: string } | undefined => {
  const walk = (at: string, depth: number): { file: string; text: string } | undefined => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (depth < 4 && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          const found = walk(path, depth + 1);
          if (found !== undefined) return found;
        }
        continue;
      }
      if (!/\.(ts|js|mts|mjs|cjs)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const text = textOf(path);
      if (text !== undefined && test(text)) return { file: relative(dir, path).split(sep).join('/'), text };
    }
    return undefined;
  };
  for (const source of SOURCE_DIRS) {
    const found = walk(join(dir, source), 0);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** Whether an environment file, or an example of it to copy, is in the checkout. */
const envFileThere = (dir: string, path: string): boolean => {
  const full = join(dir, path);
  if (textOf(full) !== undefined) return true;
  const name = full.slice(full.lastIndexOf(sep) + 1);
  const folder = full.slice(0, full.length - name.length);
  return filesIn(folder).some((other) => other.startsWith(`${name}.`) && isExampleEnvFile(other));
};

/**
 * The environment files the code loads itself and the checkout does not hold
 * (P401): a `.env` is often kept out of a repository, and whatever it sets
 * is set where the reading does not look.
 */
const envFilesLoadedMissing = (dir: string): string[] => {
  const out: string[] = [];
  for (const load of ENV_LOADS) {
    const found = sourceMatching(dir, (text) => load.test.test(text));
    if (found === undefined) continue;
    const path = load.path?.exec(found.text)?.[1] ?? '.env';
    if (!envFileThere(dir, path)) out.push(`${path} (loaded by ${found.file})`);
  }
  const nest = sourceMatching(dir, (text) => text.includes('ConfigModule') && NEST_CONFIG.test(text));
  const options = nest === undefined ? undefined : (NEST_CONFIG.exec(nest.text)?.[1] ?? '');
  if (nest !== undefined && options !== undefined && !/\bignoreEnvFile\s*:\s*true\b/.test(options)) {
    const named = /\benvFilePath\s*:\s*(\[[^\]]*\]|['"][^'"]+['"]|[^,}\s]+)/.exec(options)?.[1];
    const paths = named === undefined ? ['.env'] : [...named.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!);
    if (named !== undefined && paths.length === 0) out.push(`the environment file ${nest.file} names at run time (${named})`);
    else if (!paths.some((path) => envFileThere(dir, path))) out.push(`${paths[0]} (loaded by ${nest.file})`);
  }
  return [...new Set(out)];
};

/** What one service's deployment files name. */
export const settingNamesOf = (dir: string): SettingNames => {
  const names = new Map<string, Set<string>>();
  const files = new Set<string>();
  const unread: string[] = [];
  const add = (name: string, file: string): void => {
    if (!NAME.test(name)) return;
    names.set(name, (names.get(name) ?? new Set()).add(file));
    files.add(file);
  };
  const held = new Set<string>();
  const envFrom: Array<{ name: string; file: string }> = [];
  const at = (path: string): string => relative(dir, path).split(sep).join('/');
  const missing: string[] = [];
  const injected: string[] = [];
  const readEnvAt = (path: string): boolean => {
    const text = textOf(path);
    if (text === undefined) return false;
    files.add(at(path));
    for (const name of envNames(text)) add(name, at(path));
    return true;
  };
  /** A secrets tool a command starts the service through, said once per file. */
  const injectsIn = (text: string, file: string): void => {
    // `CMD ["doppler", "run", "--", "node", "main.js"]` read as the words it runs.
    const tool = INJECTOR.exec(text.replace(/["',[\]]+/g, ' ').replace(/\s+/g, ' '))?.[1];
    if (tool !== undefined) injected.push(`${tool} in ${file}`);
  };
  for (const folder of ['', ...DEPLOY_DIRS]) {
    const base = folder === '' ? dir : join(dir, folder);
    for (const name of filesIn(base)) {
      const path = join(base, name);
      if (envFileReading(name) !== undefined || name === '.dev.vars') {
        readEnvAt(path);
        continue;
      }
      if (name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.endsWith('.Dockerfile')) {
        const text = textOf(path);
        if (text === undefined) continue;
        files.add(at(path));
        for (const each of dockerfileNames(text)) add(each, at(path));
        injectsIn(text, at(path));
        continue;
      }
      if (folder === '' && name === 'package.json') {
        const text = textOf(path);
        const scripts = text === undefined ? undefined : (() => {
          try {
            const parsed = JSON.parse(text) as unknown;
            return isRecord(parsed) && isRecord(parsed['scripts']) ? parsed['scripts'] : undefined;
          } catch {
            return undefined;
          }
        })();
        // The scripts that start it: a secrets tool there hands its settings in.
        for (const key of ['start', 'start:prod', 'serve']) {
          const script = scripts?.[key];
          if (typeof script === 'string') injectsIn(script, `the ${key} script of package.json`);
        }
        continue;
      }
      if (name === 'wrangler.toml' || name === 'wrangler.json' || name === 'wrangler.jsonc') {
        const text = textOf(path);
        if (text === undefined) continue;
        let document: unknown;
        try {
          document = name.endsWith('.toml') ? readWorkerToml(text) : parseJsonc(text);
        } catch {
          unread.push(at(path));
          continue;
        }
        files.add(at(path));
        if (!isRecord(document)) continue;
        for (const key of environmentKeys(document['vars'])) add(key, at(path));
        if (isRecord(document['env'])) for (const block of Object.values(document['env'])) if (isRecord(block)) for (const key of environmentKeys(block['vars'])) add(key, at(path));
        continue;
      }
      if (!/\.ya?ml$/.test(name)) continue;
      const text = textOf(path);
      if (text === undefined) continue;
      let documents: unknown[];
      try {
        documents = parseAllDocuments(text, { logLevel: 'silent' }).map((document) => document.toJS({ maxAliasCount: 100 }) as unknown);
      } catch {
        unread.push(at(path));
        continue;
      }
      if (isComposeFile(name)) {
        files.add(at(path));
        const [document] = documents;
        const services = isRecord(document) && isRecord(document['services']) ? document['services'] : {};
        for (const [serviceName, service] of Object.entries(services)) {
          if (!isRecord(service)) continue;
          for (const key of environmentKeys(service['environment'])) add(key, at(path));
          const envFiles = typeof service['env_file'] === 'string' ? [service['env_file']] : Array.isArray(service['env_file']) ? service['env_file'] : [];
          for (const each of envFiles) {
            const file = typeof each === 'string' ? each : isRecord(each) && typeof each['path'] === 'string' ? each['path'] : undefined;
            // Named and not there (P401): kept out of the checkout, or outside it.
            if (file !== undefined && !readEnvAt(join(base, file))) missing.push(`${file} (env_file of ${serviceName} in ${at(path)})`);
          }
          if (Array.isArray(service['secrets']) && service['secrets'].length > 0) injected.push(`the secrets of ${serviceName} in ${at(path)}`);
          for (const key of ['command', 'entrypoint']) {
            const run = service[key];
            const said = typeof run === 'string' ? run : Array.isArray(run) ? run.filter((part) => typeof part === 'string').join(' ') : '';
            injectsIn(said, at(path));
          }
        }
        continue;
      }
      if (name === 'serverless.yml' || name === 'serverless.yaml') {
        files.add(at(path));
        const [document] = documents;
        if (!isRecord(document)) continue;
        if (isRecord(document['provider'])) for (const key of environmentKeys(document['provider']['environment'])) add(key, at(path));
        if (isRecord(document['functions'])) for (const fn of Object.values(document['functions'])) if (isRecord(fn)) for (const key of environmentKeys(fn['environment'])) add(key, at(path));
        continue;
      }
      // A cluster's manifest: any document that says what kind of object it is.
      if (!documents.some((document) => isRecord(document) && typeof document['kind'] === 'string')) continue;
      files.add(at(path));
      const found = manifestNames(documents);
      for (const each of found.names) add(each, at(path));
      for (const each of found.held) held.add(each);
      for (const each of found.envFrom) envFrom.push({ name: each, file: at(path) });
    }
  }
  const sorted: Record<string, string[]> = {};
  for (const name of [...names.keys()].sort()) sorted[name] = [...names.get(name)!].sort();
  const notWritten = envFrom.filter((each) => !held.has(each.name));
  const schema = schemaIn(dir);
  missing.push(...envFilesLoadedMissing(dir));
  return {
    names: sorted,
    files: [...files].sort(),
    ...(unread.length === 0 ? {} : { unread: [...new Set(unread)].sort() }),
    ...(notWritten.length === 0 ? {} : { from: [...new Set(notWritten.map((each) => `${each.name} (${each.file})`))].sort() }),
    ...(schema === undefined ? {} : { schema }),
    ...(missing.length === 0 ? {} : { missing: [...new Set(missing)] }),
    ...(injected.length === 0 ? {} : { injected: [...new Set(injected)] }),
  };
};
