import { mkdtempSync, rmSync, statSync, watch as watchFs, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isWithinDir, loadConfig, SERVICES_DIRECTORY, standInsOfBuild, type LoadedConfig, type ServiceConfig } from '@flowatlas/core';
import { missedOf } from '@flowatlas/linker';
import { watch, type FSWatcher } from 'chokidar';
import {
  buildProject,
  leftoversLine,
  summariseRebuild,
  type BuildOptions,
  type BuildResult,
} from '../commands/build.js';
import { cachePathFor, loadBuildCache, type BuildCache } from './cache.js';
import { openSession, type ServiceSession } from './session.js';
import {
  admits,
  mattersTo,
  rootsOf,
  surroundingsOf,
  watchingLine,
  type PathKind,
  type WatchEventName,
  type WatchTarget,
} from './watch-surroundings.js';

/** Long enough for a formatter to finish rewriting a directory, short enough to feel live. */
const DEBOUNCE_MS = 150;

/** Directories that never hold sources, and would loop the watch if they did. */
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.flowatlas', '.git']);

/** What a watcher is asked to leave alone: a path, and what it is when the watcher has looked. */
export type WatchIgnored = (path: string, kind: PathKind) => boolean;

/**
 * A file watcher, as the watch uses one: chokidar's, or a test's (P206).
 *
 * Narrow on purpose, so that a test can say "this directory appeared" without
 * waiting for a kernel to say it, and so that the rest of the watch does not
 * depend on which library is listening.
 */
export interface FileWatcher {
  on(listener: (event: WatchEventName, path: string) => void): void;
  /** Starts watching more directories, under the same rules, resolving once it is listening to them. */
  add(paths: readonly string[]): Promise<void>;
  unwatch(paths: readonly string[]): void;
  close(): Promise<void>;
}

/** Starts a watcher on some directories, resolving once it has looked at what is there and is listening. */
export type OpenWatcher = (paths: readonly string[], ignored: WatchIgnored) => Promise<FileWatcher>;

const EVENTS: ReadonlySet<string> = new Set<WatchEventName>(['add', 'addDir', 'change', 'unlink', 'unlinkDir']);

/** How often a watch not heard from yet is written to, and for how long before going on without it. */
const PROBE_EVERY_MS = 20;
const PROBE_WITHIN_MS = 10_000;

/** A watch on one directory, as the probe uses one: `fs.watch`, or a test's. */
export type WatchDirectory = (dir: string, listener: () => void) => { close(): void };

// An error on it (the directory removed under it) only means it is not heard from.
const watchDirectory: WatchDirectory = (dir, listener) => watchFs(dir, () => listener()).on('error', () => {});

export interface ProbeOptions {
  readonly watchDirectory?: WatchDirectory;
  readonly everyMs?: number;
  readonly withinMs?: number;
}

/** A directory of the watch's own, and the watches on it, held until the watcher closes. */
export interface Probe {
  /** Starts one more watch on the directory and writes into it until that watch reports; whether it did. */
  heard(): Promise<boolean>;
  close(): void;
}

/**
 * Whether a watcher is listening yet, asked the only way the platform answers
 * it: a change made after it started, reported (R178).
 *
 * Chokidar says it is ready once it has looked at what is there and started a
 * watch on each directory. On macOS a directory's watch is not listening when
 * it starts: every watch a process holds is one stream of file system events,
 * and starting another stops that stream and starts it again on a thread of its
 * own, a moment later. A change made in between is never reported to any of
 * them. Under load the moment is long enough for a test, or a script, that
 * makes a change as soon as the watch says it is watching to make it unheard.
 *
 * So after the watcher is ready, one more watch is started on a directory of
 * the watch's own, outside every repository, and written into until it
 * reports. Started last, the stream that reports it was started with every
 * other watch in it, and nothing restarts it before the caller is told. The
 * watch is kept until the watcher closes, because closing it would restart the
 * stream once more. Elsewhere a watch listens from the moment it starts and
 * the first write is heard. A directory that cannot be made, or a write never
 * heard, leaves the watcher as ready as chokidar said and no more.
 */
export const openProbe = (options: ProbeOptions = {}): Probe => {
  const start = options.watchDirectory ?? watchDirectory;
  const every = options.everyMs ?? PROBE_EVERY_MS;
  const within = options.withinMs ?? PROBE_WITHIN_MS;
  const watches: Array<{ close(): void }> = [];
  let dir: string | undefined;
  return {
    heard: async () => {
      try {
        dir ??= mkdtempSync(join(tmpdir(), 'flowatlas-watch-'));
        const at = join(dir, 'probe');
        let heard = false;
        let wake: (() => void) | undefined;
        watches.push(
          start(dir, () => {
            heard = true;
            wake?.();
          }),
        );
        const until = Date.now() + within;
        for (let written = 0; !heard && Date.now() < until; written += 1) {
          writeFileSync(at, String(written));
          await new Promise<void>((done) => {
            wake = done;
            setTimeout(done, every);
          });
        }
        return heard;
      } catch {
        return false;
      }
    },
    close: () => {
      for (const each of watches.splice(0)) each.close();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    },
  };
};

/**
 * The watcher a watch uses unless it is handed another: chokidar, waiting for
 * a save to finish, and listening before it resolves.
 *
 * Directories added later get a chokidar of their own, so that the watcher
 * knows when it is ready on them and can ask whether it is listening (R178):
 * chokidar says it is ready once in its life, and not when an `add` is done.
 * Two of them on one directory share the platform's watch on it. A directory
 * let go is let go by the one started on it; the others go on judging what
 * is below it by the rules, which change with the places watched.
 */
export const openChokidar = async (
  paths: readonly string[],
  ignored: WatchIgnored,
  options: ProbeOptions = {},
): Promise<FileWatcher> => {
  const listeners: Array<(event: WatchEventName, path: string) => void> = [];
  const parts: Array<{ watcher: FSWatcher; roots: Set<string> }> = [];
  const closing: Array<Promise<void>> = [];
  const probe = openProbe(options);
  const start = async (roots: readonly string[]): Promise<void> => {
    // Started on nothing, chokidar never says it is ready: there is nothing to
    // look at until a directory is added.
    if (roots.length === 0) return;
    const watcher = watch([...roots], {
      ignoreInitial: true,
      ignored: (path, stats) => ignored(path, stats === undefined ? 'unknown' : stats.isDirectory() ? 'dir' : 'file'),
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    });
    watcher.on('all', (event, path) => {
      if (!EVENTS.has(event)) return;
      for (const listener of listeners) listener(event as WatchEventName, path);
    });
    parts.push({ watcher, roots: new Set(roots) });
    await new Promise<void>((ready) => watcher.once('ready', () => ready()));
    await probe.heard();
  };
  await start(paths);
  return {
    on: (listener) => {
      listeners.push(listener);
    },
    add: (more) => start(more),
    unwatch: (gone) => {
      for (const part of [...parts]) {
        const mine = gone.filter((dir) => part.roots.has(dir));
        if (mine.length === 0) continue;
        for (const dir of mine) part.roots.delete(dir);
        if (part.roots.size > 0) {
          part.watcher.unwatch(mine);
          continue;
        }
        parts.splice(parts.indexOf(part), 1);
        closing.push(part.watcher.close());
      }
    },
    close: async () => {
      await Promise.all([...closing.splice(0), ...parts.splice(0).map((part) => part.watcher.close())]);
      probe.close();
    },
  };
};

export interface WatchOptions extends BuildOptions {
  /** How long to wait for a burst of saves to settle. */
  debounceMs?: number;
  /** Where the summary goes. Standard error by default. */
  print?: (line: string) => void;
  /** Called after every rebuild, for tests and for the bench. */
  onRebuild?: (result: BuildResult) => void;
  /** How a watcher is started; chokidar unless a test hands it another. */
  openWatcher?: OpenWatcher;
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

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Rebuilds after every change, keeping each repository parsed in between.
 *
 * The watcher only says that something happened; what changed is worked out
 * from file hashes by the build itself, exactly as it is for a one-off run.
 * That keeps one answer to "what needs re-reading" instead of two, and means a
 * change the watcher misses is still caught by the next rebuild.
 *
 * Beside the repositories it watches what stands in for a package nobody
 * installed (P206): the directories beside the configuration and their
 * manifests, the members of a workspace kept there, the shape and pattern
 * files the configuration lists, the files a reading read from outside every
 * repository, and where each repository is. See `watch-surroundings.ts`.
 */
export const watchProject = async (options: WatchOptions = {}): Promise<WatchHandle> => {
  // Each of these follows the configuration when it is edited (P219).
  let loaded = loadConfig(options.config ?? process.cwd());
  // Resolved the way the build resolves it, so `--out` moves what is ignored too.
  const outputOf = (config: LoadedConfig): string => (options.out === undefined ? config.outputDir : resolve(options.out));
  let outputDir = outputOf(loaded);
  const print = options.print ?? ((line: string) => process.stderr.write(`${line}\n`));
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const openWatcher = options.openWatcher ?? openChokidar;
  let services = loaded.config.services;

  const sessions = new Map<string, ServiceSession>();
  const open = (service: ServiceConfig): void => {
    // Worked out for every repository held open (P82), as a build works them
    // out once for the readers it starts.
    const session = openSession({
      service,
      repoDir: loaded.repoDir(service),
      config: loaded.config,
      configDir: loaded.rootDir,
      standInsOfBuild: standIns,
    });
    if (session !== undefined) sessions.set(service.name, session);
  };
  let standIns = standInsOfBuild(loaded.config, loaded.rootDir);
  for (const service of services) open(service);

  let previousUnresolved: number | undefined;
  let last: BuildResult | undefined;
  let running: Promise<void> | undefined;
  let queued = false;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const repositories = new Map<string, FileWatcher>();
  /** Repositories whose directory came or went since the last rebuild. */
  const moved = new Set<string>();
  /** Whether the configuration was edited since it was last loaded. */
  let edited = false;
  let surroundings: FileWatcher | undefined;
  let targets: WatchTarget[] = [];

  const seenByRepository = (path: string): boolean =>
    services.some((service) => {
      const repoDir = loaded.repoDir(service);
      return isWithinDir(path, repoDir) && !isIgnored(repoDir, path, outputDir);
    });

  const lastCache = (): BuildCache | null => {
    const found = loadBuildCache(last?.cachePath ?? cachePathFor(outputDir));
    return found !== null && 'cache' in found ? found.cache : null;
  };

  const targetsNow = (): WatchTarget[] =>
    surroundingsOf({
      config: loaded.config,
      configPath: loaded.configPath,
      rootDir: loaded.rootDir,
      repoDirOf: (service) => loaded.repoDir(service),
      outputDir,
      seenByRepository,
      cache: lastCache(),
    });

  /**
   * The places beside the repositories, worked out again after a rebuild: a
   * directory that appeared is watched from its own place from now on, and one
   * that went is watched from where it would appear again.
   */
  const retarget = async (): Promise<void> => {
    if (surroundings === undefined) return;
    const before = new Set(rootsOf(targets));
    const next = targetsNow();
    const after = new Set(rootsOf(next));
    // The rules first, then the directories, so a path under a directory
    // being added is judged by the rules it is added for.
    targets = next;
    surroundings.unwatch([...before].filter((dir) => !after.has(dir)));
    // Part of the rebuild, so the watch is not settled until it listens there.
    await surroundings.add([...after].filter((dir) => !before.has(dir)));
  };

  const watchRepository = async (service: ServiceConfig): Promise<void> => {
    const repoDir = loaded.repoDir(service);
    if (!isDirectory(repoDir)) return;
    const watcher = await openWatcher([repoDir], (path) => isIgnored(repoDir, path, outputDir));
    watcher.on(() => touched());
    repositories.set(service.name, watcher);
  };

  /**
   * A repository whose directory came or went is opened again: the program
   * held open and the watch on it both belong to a directory that is gone. One
   * that is not there now is left closed, and the build says so.
   */
  const reopenMoved = async (): Promise<void> => {
    if (moved.size === 0) return;
    standIns = standInsOfBuild(loaded.config, loaded.rootDir);
    for (const name of [...moved]) {
      moved.delete(name);
      const service = services.find((each) => each.name === name);
      if (service === undefined) continue;
      await repositories.get(name)?.close();
      repositories.delete(name);
      sessions.delete(name);
      if (!isDirectory(loaded.repoDir(service))) continue;
      open(service);
      await watchRepository(service);
    }
  };

  /** Where a service is read from and how, so an edit that moves either reopens it. */
  const placeOf = (service: ServiceConfig): string => JSON.stringify([service, loaded.repoDir(service)]);

  /**
   * The configuration, loaded again after an edit (P219). Every repository is
   * opened again, since what it is read with is the configuration; the watch
   * on one stays where its directory did not move, and a service the
   * configuration no longer names is let go. One that does not load is left
   * for the build to say why, and tried again on the next rebuild.
   */
  const reload = async (): Promise<void> => {
    if (!edited) return;
    let next: LoadedConfig;
    try {
      next = loadConfig(loaded.configPath);
    } catch {
      return;
    }
    edited = false;
    const before = new Map(services.map((service) => [service.name, placeOf(service)]));
    loaded = next;
    outputDir = outputOf(next);
    services = next.config.services;
    standIns = standInsOfBuild(loaded.config, loaded.rootDir);
    const after = new Map(services.map((service) => [service.name, placeOf(service)]));
    for (const [name, place] of before) {
      if (after.get(name) === place) continue;
      await repositories.get(name)?.close();
      repositories.delete(name);
    }
    sessions.clear();
    for (const service of services) {
      open(service);
      if (!repositories.has(service.name)) await watchRepository(service);
    }
  };

  const rebuild = async (): Promise<void> => {
    await reload();
    await reopenMoved();
    try {
      const result = await buildProject({ ...options, sessions });
      print(summariseRebuild(result, previousUnresolved));
      // Once, on the first build: the watch prints one line per rebuild, and a
      // note about the disk repeated on every save would drown the line that
      // says what the save did.
      const leftovers = last === undefined ? leftoversLine(result.leftovers) : undefined;
      if (leftovers !== undefined) print(leftovers);
      if (options.timing === true) print(JSON.stringify(result.timing));
      previousUnresolved = missedOf(result.report.totals);
      last = result;
      options.onRebuild?.(result);
    } finally {
      await retarget();
    }
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

  /** A change beside the repositories, when it is one the build depends on. */
  const aside = (event: WatchEventName, path: string): void => {
    const kinds = mattersTo(targets, event, path);
    if (kinds.length === 0) return;
    if (kinds.includes('configuration')) edited = true;
    if (kinds.includes('repository')) {
      for (const service of services) {
        const repoDir = loaded.repoDir(service);
        if (isWithinDir(path, repoDir) && isWithinDir(repoDir, path)) moved.add(service.name);
      }
    }
    touched();
  };

  trigger();
  await running;

  // Waited for, not just started: a change made before the first scan finishes,
  // or before the platform is listening (R178), is never reported, and the
  // caller is entitled to believe that when this resolves the project is being
  // watched.
  await Promise.all(services.map((service) => watchRepository(service)));
  targets = targetsNow();
  surroundings = await openWatcher(rootsOf(targets), (path, kind) => !admits(targets, path, kind));
  surroundings.on(aside);

  const settled = async (): Promise<void> => {
    while (running !== undefined || queued || timer !== undefined) {
      await running;
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 10));
    }
  };

  print(watchingLine(repositories.size, targets));

  return {
    last: () => last,
    settled,
    close: async () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      await running;
      await Promise.all([...repositories.values(), ...(surroundings === undefined ? [] : [surroundings])].map((watcher) => watcher.close()));
    },
  };
};
