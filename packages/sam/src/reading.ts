import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { DeliveryTarget, PathStep, PositionedDocument } from '@flowatlas/core';
import { readServiceFile, Unread, type Deployed, type FileReading, type Resource } from '@flowatlas/serverless';

/**
 * A path a template writes relative to its own directory, repo-relative;
 * `undefined` for an S3 or web location, and for one outside the repository.
 */
export const localPath = (dir: string, written: string): string | undefined => {
  if (/^(s3|https?):/.test(written)) return undefined;
  const file = posix.normalize(posix.join(dir, written)).replace(/\/$/, '');
  return file.startsWith('..') ? undefined : file === '' ? '.' : file;
};
import type { DeployConfig } from './config.js';
import type { Resolver } from './intrinsics.js';

/**
 * What every part of reading one SAM template shares (P246): the reading of
 * the file the Serverless Framework reader's parts are written against, and
 * what only a template has - its parameters and conditions, the functions it
 * declares as resources, and the APIs their events hang routes from.
 */

/** A function the template declares, by its logical id. */
export interface DeclaredFunction {
  readonly resource: Resource;
  /** Its position among the deployment's functions. */
  readonly index: number;
  /** Its deployed name, a stand-in where the platform generates it; unread where the files do not settle it. */
  readonly name: string | Unread;
  readonly generated: boolean;
}

export class TemplateReading {
  /** The functions, by logical id, filled before anything that points at one is read. */
  readonly functions = new Map<string, DeclaredFunction>();
  /** Each resource declared under a condition the files do not settle, by logical id: the condition. */
  readonly conditional = new Map<string, string>();

  constructor(
    readonly file: FileReading,
    readonly resolver: Resolver,
    readonly config: DeployConfig,
    /** Repo-relative directory of the template, `.` at the root. */
    readonly dir: string,
    /** Put before every address, to keep a nested template's apart from its parent's. */
    readonly scope: string,
    /** The `Globals` section, resolved. */
    readonly globals: Readonly<Record<string, Record<string, unknown>>>,
    /** Absolute path of the repository. */
    readonly repoDir: string,
    /** Absolute paths of every file read beside the template, filled as they are. */
    readonly loaded: Set<string>,
  ) {}

  /**
   * A file the template points at, relative to its directory, read as a
   * positioned document; `undefined` when it is not there or not in the
   * repository. Throws `ServiceFileUnreadable` when it is there and does not parse.
   */
  local(written: string): { readonly file: string; readonly document: PositionedDocument } | undefined {
    const file = localPath(this.dir, written);
    if (file === undefined) return undefined;
    const path = join(this.repoDir, file);
    if (!existsSync(path)) return undefined;
    this.loaded.add(path);
    return { file, document: readServiceFile(path) };
  }

  get template() {
    return this.file.template;
  }

  /** A function of this template by its deployed name, so a route's URI written out joins it by position. */
  functionNamed(name: string): DeclaredFunction | undefined {
    for (const fn of this.functions.values()) if (fn.name === name) return fn;
    return undefined;
  }

  /** What a value names, a function of this template placed by its position. */
  deployedOf(value: unknown): Deployed | Unread | undefined {
    const found = this.template.deployedOf(value);
    if (found === undefined || found instanceof Unread || found.kind !== 'function' || found.function !== undefined) return found;
    const own = this.functionNamed(found.name);
    return own === undefined ? found : { ...found, function: own.index };
  }

  /** The condition a resource is declared under, for what it draws. */
  conditionOf(logicalId: string): Record<string, unknown> {
    const condition = this.conditional.get(logicalId);
    return condition === undefined ? {} : { conditional: condition };
  }

  /** A target, as the Serverless reader's rule gives one, the row included. */
  targetOf(found: Deployed | Unread | undefined, path: readonly PathStep[], symbol: string, what: string): DeliveryTarget | undefined {
    return this.file.targetOf(found, path, symbol, what);
  }
}
