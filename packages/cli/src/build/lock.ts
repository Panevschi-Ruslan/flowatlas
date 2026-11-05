import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

/**
 * One build at a time (P230).
 *
 * Nothing used to stop two builds writing one database at once: a watch and a
 * build typed in another terminal, or two hooks. A build now takes
 * `<output>/build.lock` for as long as it reads and writes, created with `wx`
 * so two cannot both take it, as `observe`'s store takes its own. A watch takes
 * it for each rebuild, not for its lifetime, so a build in between still runs.
 *
 * A lock whose process is gone - a crash, a killed terminal - is taken over
 * and the taking over is said: a crashed build must not lock a project for
 * ever. Whether a process is alive can only be asked on the machine it ran on,
 * so a lock from another host (a shared disk) is respected and named.
 */
export const LOCK_FILE = 'build.lock';

/** A background build waiting for the lock: the one more pass every request during a build earns. */
export const AGAIN_FILE = 'build.again';

/** Where a background build writes what it says. */
export const BUILD_LOG = 'build.log';

/** Past this the log is moved aside to `build.1.log`, so at most two are kept. */
export const BUILD_LOG_LIMIT = 1024 * 1024;

export interface LockHolder {
  pid: number;
  host: string;
  /** When it was taken, ISO. */
  startedAt: string;
}

/** A build that could not take the lock in the time it was given. */
export class BuildBusyError extends Error {
  readonly holder: LockHolder;

  constructor(holder: LockHolder) {
    super(`a build is running (pid ${holder.pid}${holder.host === hostname() ? '' : ` on ${holder.host}`}, since ${holder.startedAt})`);
    this.name = 'BuildBusyError';
    this.holder = holder;
  }
}

const readHolder = (path: string): LockHolder | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockHolder>;
    return typeof parsed.pid === 'number' && typeof parsed.host === 'string' && typeof parsed.startedAt === 'string'
      ? { pid: parsed.pid, host: parsed.host, startedAt: parsed.startedAt }
      : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a process on this machine is still running. */
export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM: it exists, it is just not ours to signal.
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Whether a holder has gone: only answerable on its own host. */
const isGone = (holder: LockHolder | undefined): boolean =>
  holder === undefined || (holder.host === hostname() && !isAlive(holder.pid));

const writeNew = (path: string, holder: LockHolder): boolean => {
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw cause;
  }
  try {
    writeSync(fd, `${JSON.stringify(holder)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
};

export interface HeldLock {
  /** Gives the lock back; a second call does nothing. */
  release(): void;
  /** Set when a lock left by a process that is gone was taken over. */
  tookOver?: LockHolder;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Takes the build lock of `outputDir`, waiting up to `waitMs` for a build
 * that holds it, or throws `BuildBusyError` naming it.
 */
export const acquireBuildLock = async (outputDir: string, waitMs = 0): Promise<HeldLock> => {
  const path = join(outputDir, LOCK_FILE);
  const mine: LockHolder = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  const until = Date.now() + waitMs;
  let tookOver: LockHolder | undefined;
  for (;;) {
    if (writeNew(path, mine)) break;
    const holder = readHolder(path);
    if (isGone(holder)) {
      // A lock half-written by a build that died while writing it reads as nobody's.
      if (holder !== undefined) tookOver = holder;
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() >= until) throw new BuildBusyError(holder as LockHolder);
    await sleep(Math.min(250, Math.max(10, until - Date.now())));
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      // Only ours: a lock someone took over from us after a pause is theirs now.
      if (readHolder(path)?.pid === mine.pid) rmSync(path, { force: true });
    },
    ...(tookOver === undefined ? {} : { tookOver }),
  };
};

/**
 * Queues one background build, unless one is already waiting (P230 D4).
 *
 * Ten hooks firing during one build need one more pass, not ten: the first
 * request writes `build.again` and starts a build that waits for the lock;
 * the rest find it waiting and leave. The waiting build removes the file when
 * it takes the lock, so a change after that queues the next. Returns false
 * when one is already queued.
 */
export const queueAgain = (outputDir: string, pid: number): boolean => {
  const path = join(outputDir, AGAIN_FILE);
  const entry: LockHolder = { pid, host: hostname(), startedAt: new Date().toISOString() };
  if (writeNew(path, entry)) return true;
  if (!isGone(readHolder(path))) return false;
  rmSync(path, { force: true });
  return writeNew(path, entry);
};

/** Names the waiting build in `build.again` once it has started, in place of the process that started it. */
export const claimAgain = (outputDir: string, from: number, pid: number): void => {
  const path = join(outputDir, AGAIN_FILE);
  const holder = readHolder(path);
  if (holder?.pid !== from) return;
  rmSync(path, { force: true });
  writeNew(path, { ...holder, pid });
};

/** Takes this build off the queue once it holds the lock: a change from now on earns another pass. */
export const leaveQueue = (outputDir: string, pid: number): void => {
  const path = join(outputDir, AGAIN_FILE);
  if (readHolder(path)?.pid === pid) rmSync(path, { force: true });
};

/** Moves a log past `BUILD_LOG_LIMIT` aside, so a background build never grows one without end. */
export const rotateBuildLog = (outputDir: string): string => {
  const path = join(outputDir, BUILD_LOG);
  try {
    if (existsSync(path) && statSync(path).size > BUILD_LOG_LIMIT) renameSync(path, join(outputDir, 'build.1.log'));
  } catch {
    // A log that cannot be moved is written on; nothing depends on its size.
  }
  return path;
};
