import { existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { stackOutputKey, type PathStep, type PositionedDocument } from '@flowatlas/core';
import { readServiceFile, ServiceFileUnreadable } from './document.js';
import type { DeploymentParts } from './reading.js';
import { readService } from './service.js';
import { DEFAULT_STAGE, Imported, isRecord, textOf, Unread, Variables } from './variables.js';

/**
 * A `serverless-compose.yml`: several services of one repository deployed as
 * one (P249).
 *
 * Each service the file lists is read as P57 reads a service file, with the
 * compose file's `params` handed to its `${param:...}` ahead of its own, and
 * the stage it is deployed with handed to all of them. A param written
 * `${<service>.<Output>}` is an output of another service of the composition,
 * which is the output of that service's stack: an import under the stack's
 * name, which the other service's own outputs answer when the linker joins
 * them (P249, D8). A service the file lists and this cannot read is a row.
 */

/** The names a compose file goes by, in the order the framework looks for them. */
export const COMPOSE_FILES = ['serverless-compose.yml', 'serverless-compose.yaml', 'serverless-compose.json', 'serverless-compose.ts', 'serverless-compose.js'];

export interface ComposeOptions {
  /** Absolute path of the repository. */
  readonly repoDir: string;
  /** Repo-relative path of the compose file. */
  readonly file: string;
  /** What the deployment is run with (`services[].infra.options`). */
  readonly options: Readonly<Record<string, string>>;
  /** Absolute paths of every file read beside it, filled as they are. */
  readonly loaded: Set<string>;
  /** The service file a directory holds, repo-relative, or `undefined`. */
  readonly serviceFileIn: (dir: string) => string | undefined;
}

/** One service of the composition, as the compose file lists it. */
interface Composed {
  readonly key: string;
  readonly path: readonly PathStep[];
  /** Repo-relative path of its service file. */
  readonly file: string;
  readonly params: Record<string, unknown>;
  /** The name its stack is deployed under, or why it is not read. */
  readonly stack: string | Unread;
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** The name a service's stack is deployed under: `provider.stackName`, else `<service>-<stage>`. */
const stackOf = (repoDir: string, file: string, options: Readonly<Record<string, string>>, loaded: Set<string>): string | Unread => {
  let document: PositionedDocument;
  try {
    document = readServiceFile(join(repoDir, file));
  } catch {
    return new Unread(`${file} is not read`);
  }
  const variables = new Variables({ document: document.value, dir: join(repoDir, posix.dirname(file)), options, loaded });
  const own = textOf(variables.at(['provider', 'stackName']));
  if (own !== undefined) return own;
  const written = variables.at(['service']);
  const service = textOf(isRecord(written) ? written['name'] : written);
  const stage = textOf(variables.stage.value);
  if (service === undefined) return new Unread(`the name of the service in ${file} is not read`);
  if (stage === undefined) return new Unread(`the stage ${file} is deployed to is not read`);
  return `${service}-${stage}`;
};

/**
 * A compose param, as the service it is handed to reads it: `${<service>.<Output>}`
 * an import of that service's output, `${sls:stage}` the stage, anything else as written.
 */
const paramOf = (value: unknown, stacks: ReadonlyMap<string, string | Unread>, stage: string): unknown => {
  if (typeof value !== 'string' || !value.includes('${')) return value;
  const whole = /^\$\{\s*([\w-]+)\.([\w-]+)\s*\}$/.exec(value);
  if (whole !== null) {
    const [, key, output] = whole as unknown as [string, string, string];
    const stack = stacks.get(key);
    if (stack === undefined) return new Unread(`\${${key}.${output}} names ${key}, which the compose file does not list`, `${key}.${output}`);
    if (stack instanceof Unread) return new Unread(`\${${key}.${output}} is an output of ${key}, whose stack's name is not read: ${stack.text}`, `${key}.${output}`);
    return new Imported(stackOutputKey(stack, output), `the value is the output ${output} of ${key}, deployed as the stack ${stack}`, `${key}.${output}`);
  }
  if (/^\$\{sls:stage\}$/.test(value)) return stage;
  return new Unread(`the compose param ${value} is not read`, value.slice(2, -1));
};

/** Reads one compose file; gives back the service files it read, so they are not read again on their own. */
export const readCompose = (parts: DeploymentParts, options: ComposeOptions): Set<string> => {
  const { repoDir, file } = options;
  const read = new Set<string>();
  let document: PositionedDocument;
  try {
    document = readServiceFile(join(repoDir, file));
  } catch (cause) {
    parts.rows.push({
      file,
      line: cause instanceof ServiceFileUnreadable ? cause.line : 1,
      reason: 'infra-file-unparsed',
      message: `${file} is not read: ${cause instanceof Error ? cause.message : String(cause)}`,
      hint: 'The services it lists are read on their own, without its params. If it is valid, this is a defect in the reader: report it with the line.',
    });
    return read;
  }
  const lineOf = (path: readonly PathStep[]): number => {
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const at = document.at(path.slice(0, depth));
      if (at !== undefined) return at.line;
    }
    return 1;
  };
  const written = isRecord(document.value) && isRecord(document.value['services']) ? document.value['services'] : {};
  const dir = posix.dirname(file);
  const composed: Composed[] = [];
  for (const [key, service] of Object.entries(written)) {
    const path: PathStep[] = ['services', key];
    const unread = (why: string): void => {
      parts.rows.push({
        file,
        line: lineOf([...path, 'path']),
        symbol: `${file}#services.${key}`,
        reason: 'compose-service-unread',
        message: `${file} lists the service ${key}, ${why}, so nothing it declares is read`,
        hint: 'Point path at a folder of the repository holding a service file; a service in another repository is read where that repository is.',
      });
    };
    const folder = isRecord(service) ? textOf(service['path']) : undefined;
    if (folder === undefined) {
      unread('whose path is not written');
      continue;
    }
    const at = posix.normalize(posix.join(dir === '' ? '.' : dir, folder)).replace(/\/$/, '');
    if (at.startsWith('..')) {
      unread(`whose folder ${folder} is outside the repository`);
      continue;
    }
    const absolute = join(repoDir, at);
    if (!isDirectory(absolute)) {
      unread(`whose folder ${folder} is not there`);
      continue;
    }
    const config = isRecord(service) ? textOf(service['config']) : undefined;
    const serviceFile = config === undefined ? options.serviceFileIn(at) : posix.join(at, config);
    if (serviceFile === undefined || !existsSync(join(repoDir, serviceFile))) {
      unread(`whose folder ${folder} holds no service file${config === undefined ? '' : ` named ${config}`}`);
      continue;
    }
    // A service file named by `config` is not one the reader looks for on its own: the cache stamps it here.
    options.loaded.add(join(repoDir, serviceFile));
    const params = isRecord(service) && isRecord(service['params']) ? service['params'] : {};
    composed.push({ key, path, file: posix.normalize(serviceFile), params, stack: stackOf(repoDir, serviceFile, options.options, options.loaded) });
  }
  const stacks = new Map(composed.map((service) => [service.key, service.stack]));
  const stage = options.options['stage'] ?? DEFAULT_STAGE;
  for (const service of composed) {
    const params = Object.fromEntries(Object.entries(service.params).map(([name, value]) => [name, paramOf(value, stacks, stage)]));
    const from = parts.functions.length;
    readService(parts, { repoDir, file: service.file, options: options.options, loaded: options.loaded, params });
    // Its functions are this composition's, under the key it lists them by.
    for (let index = from; index < parts.functions.length; index += 1) {
      const fn = parts.functions[index];
      if (fn !== undefined) parts.functions[index] = { ...fn, meta: { ...fn.meta, composedAs: service.key } };
    }
    read.add(service.file);
  }
  return read;
};
