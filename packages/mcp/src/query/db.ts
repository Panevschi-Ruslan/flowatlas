import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { SCHEMA_VERSION, loadConfig, type FlowatlasConfig } from '@flowatlas/core';
import { openGraphDb, type GraphDb } from '@flowatlas/linker';

export interface SourceRoots {
  /** Absolute directory of each service, by service name. */
  repoDir(service: string): string | undefined;
}

export interface DbHandleOptions {
  /** Path to `graph.db`. Defaults to the one the configuration implies. */
  dbPath?: string;
  /** Path to `flowatlas.config.json`, or a directory to find it from. */
  configPath?: string;
}

/**
 * The database, opened when a question is asked and not before.
 *
 * A build may replace the file while the server is up, so the file's timestamp
 * is checked on every use and a newer one is reopened. There is no watching:
 * the next question sees the new graph, which is as fresh as anything needs to
 * be here.
 */
export class DbHandle implements SourceRoots {
  readonly path: string;
  readonly config: FlowatlasConfig | undefined;
  /** The configuration file read, when one was: what a configuration error names. */
  readonly configPath: string | undefined;
  /** The configuration's directory, which its relative paths are written against. */
  readonly configDir: string | undefined;
  readonly #repoDirs = new Map<string, string>();
  readonly #listeners = new Set<() => void>();
  #db: GraphDb | undefined;
  #openedAt = 0;
  #generation = 0;

  constructor(options: DbHandleOptions = {}) {
    let dbPath = options.dbPath;
    if (options.configPath !== undefined) {
      const loaded = loadConfig(options.configPath);
      this.config = loaded.config;
      this.configPath = loaded.configPath;
      this.configDir = loaded.rootDir;
      for (const service of loaded.config.services) {
        this.#repoDirs.set(service.name, loaded.repoDir(service));
      }
      dbPath ??= resolve(loaded.outputDir, 'graph.db');
    }
    if (dbPath === undefined) throw new Error('neither a database nor a configuration was given');
    this.path = isAbsolute(dbPath) ? dbPath : resolve(dbPath);
  }

  repoDir(service: string): string | undefined {
    return this.#repoDirs.get(service);
  }

  /**
   * Which database this is: a number that moves whenever a question opened a
   * file, reopened one a build replaced, or found none where one had been
   * (P201). What is read once per database is cached against it.
   */
  get generation(): number {
    return this.#generation;
  }

  /**
   * Calls `listener` whenever `generation` moves, after the move: the tool
   * list is decided again when the graph under it changed (P201). A close
   * because the client left is not a change. Returns the unsubscribe.
   */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    this.#generation += 1;
    for (const listener of [...this.#listeners]) listener();
  }

  /**
   * The database, or a sentence saying why there is none.
   *
   * A missing or stale file is an ordinary answer rather than a crash: the
   * server stays up so the next question can be asked after a rebuild.
   */
  open(): { db: GraphDb } | { error: string } {
    if (!existsSync(this.path)) {
      if (this.#db !== undefined) {
        this.#close();
        this.#changed();
      }
      return { error: `graph.db not found at ${this.path}; run flowatlas build` };
    }

    const modified = statSync(this.path).mtimeMs;
    if (this.#db !== undefined && modified !== this.#openedAt) this.#close();

    if (this.#db === undefined) {
      try {
        this.#db = openGraphDb(this.path, { readonly: true });
        this.#openedAt = modified;
      } catch (cause) {
        return { error: `cannot read ${this.path}: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
      const found = this.#db.schemaVersion();
      if (found !== SCHEMA_VERSION) {
        this.#close();
        return { error: `schema-mismatch ${found} vs ${SCHEMA_VERSION}; run flowatlas build` };
      }
      this.#changed();
    }
    return { db: this.#db };
  }

  #close(): void {
    this.#db?.close();
    this.#db = undefined;
    this.#openedAt = 0;
  }

  close(): void {
    this.#close();
  }
}
