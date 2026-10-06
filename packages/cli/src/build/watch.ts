import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfig, SERVICES_DIRECTORY } from '@flowatlas/core';
import { watch, type FSWatcher } from 'chokidar';
import {
  buildProject,
  leftoversLine,
  summariseRebuild,
  type BuildOptions,
  type BuildResult,
} from '../commands/build.js';
import { openSession, type ServiceSession } from './session.js';

/** Long enough for a formatter to finish rewriting a directory, short enough to feel live. */
const DEBOUNCE_MS = 150;

/** Directories that never hold sources, and would loop the watch if they did. */
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.flowatlas', '.git']);

export interface WatchOptions extends BuildOptions {
  /** How long to wait for a burst of saves to settle. */
  debounceMs?: number;
  /** Where the summary goes. Standard error by default. */
  print?: (line: string) => void;
  /** Called after every rebuild, for tests and for the bench. */
  onRebuild?: (result: BuildResult) => void;
}

export interface WatchHandle {
  /** Stops watching once the rebuild in flight has finished. */
  close(): Promise<void>;
  /** Resolves when nothing is running or queued. */
  settled(): Promise<void>;
  /** The build that has just finished, or the first one. */
  last(): BuildResult | undefined;
}

/** True when `path` is `dir` or anywhere beneath it. */
const isUnder = (dir: string, path: string): boolean => {
  const rest = relative(dir, path);
  return rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
};

/** Files a build writes at the top of its output directory, temporaries included. */
const isBuildOutputFile = (name: string): boolean =>
  /^(project-graph\.json|link-report\.json|cache\.json|graph\.db(-wal|-shm|-journal)?)$/.test(name) ||
  name.endsWith('.tmp') ||
  name.endsWith('.building');

/**
 * Whether a path is something the build writes, wherever the output is.
 *
 * By where it is rather than by what it is called. A configuration kept at the
 * root of a repository it reads puts the output inside that repository, and an
 * output named anything but a dot directory used to be watched: every build
 * wrote into it, every write was a change, and the watch rebuilt for ever with
 * nothing changed (R166).
 *
 * Usually the whole output directory. Not when the output directory holds the
 * repository — `"output": "."` beside a service at `./api` — because then it
 * holds the sources too; there only `services/` and the files a build writes at
 * the top are the build's.
 */
const isOutput = (repoDir: string, path: string, outputDir: string): boolean => {
  if (!isUnder(outputDir, path)) return false;
  if (!isUnder(outputDir, repoDir)) return true;
  if (isUnder(join(outputDir, SERVICES_DIRECTORY), path)) return true;
  return dirname(path) === outputDir && isBuildOutputFile(basename(path));
};

/**
 * Whether a path is one of ours rather than one of the repository's.
 *
 * Judged on the path relative to the repository, because the repository itself
 * may well sit inside a directory whose name starts with a dot.
 */
export const isIgnored = (repoDir: string, path: string, outputDir?: string): boolean => {
  if (outputDir !== undefined && isOutput(repoDir, path, outputDir)) return true;
  const rest = relative(repoDir, path);
  if (rest === '') return false;
  if (rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest)) return true;
  return rest
    .split(sep)
    .some((segment) => IGNORED_DIRECTORIES.has(segment) || segment.startsWith('.'));
};

/**
 * Rebuilds after every change, keeping each repository parsed in between.
 *
 * The watcher only says that something happened; what changed is worked out
 * from file hashes by the build itself, exactly as it is for a one-off run.
 * That keeps one answer to "what needs re-reading" instead of two, and means a
 * change the watcher misses is still caught by the next rebuild.
 */
export const watchProject = async (options: WatchOptions = {}): Promise<WatchHandle> => {
  const loaded = loadConfig(options.config ?? process.cwd());
  // Resolved the way the build resolves it, so `--out` moves what is ignored too.
  const outputDir = options.out === undefined ? loaded.outputDir : resolve(options.out);
  const print = options.print ?? ((line: string) => process.stderr.write(`${line}\n`));
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;

  const sessions = new Map<string, ServiceSession>();
  for (const service of loaded.config.services) {
    const session = openSession({
      service,
      repoDir: loaded.repoDir(service),
      config: loaded.config,
    });
    if (session !== undefined) sessions.set(service.name, session);
  }

  let previousUnresolved: number | undefined;
  let last: BuildResult | undefined;
  let running: Promise<void> | undefined;
  let queued = false;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const rebuild = async (): Promise<void> => {
    const result = await buildProject({ ...options, sessions });
    print(summariseRebuild(result, previousUnresolved));
    // Once, on the first build: the watch prints one line per rebuild, and a
    // note about the disk repeated on every save would drown the line that
    // says what the save did.
    const leftovers = last === undefined ? leftoversLine(result.leftovers) : undefined;
    if (leftovers !== undefined) print(leftovers);
    if (options.timing === true) print(JSON.stringify(result.timing));
    previousUnresolved = result.report.totals.unresolved;
    last = result;
    options.onRebuild?.(result);
  };

  /** One rebuild at a time; a save during one earns exactly one more after it. */
  const trigger = (): void => {
    if (closed) return;
    if (running !== undefined) {
      queued = true;
      return;
    }
    running = rebuild()
      .catch((error: unknown) => {
        print(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        running = undefined;
        if (queued && !closed) {
          queued = false;
          trigger();
        }
      });
  };

  const touched = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      trigger();
    }, debounceMs);
    timer.unref?.();
  };

  trigger();
  await running;

  // Waited for, not just started: a change made before the first scan finishes
  // is never reported, and the caller is entitled to believe that when this
  // resolves the project is being watched.
  const watchers: FSWatcher[] = await Promise.all(
    loaded.config.services.map(async (service) => {
      const repoDir = loaded.repoDir(service);
      const watcher = watch(repoDir, {
        ignoreInitial: true,
        ignored: (path: string) => isIgnored(repoDir, path, outputDir),
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
      });
      await new Promise<void>((ready) => watcher.once('ready', () => ready()));
      return watcher.on('all', touched);
    }),
  );

  const settled = async (): Promise<void> => {
    while (running !== undefined || queued || timer !== undefined) {
      await running;
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 10));
    }
  };

  print(`watching ${watchers.length} repositor${watchers.length === 1 ? 'y' : 'ies'}`);

  return {
    last: () => last,
    settled,
    close: async () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      await running;
      await Promise.all(watchers.map((watcher) => watcher.close()));
    },
  };
};
