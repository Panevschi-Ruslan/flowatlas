import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fstatSync, linkSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

/**
 * One build at a time (P230).
 *
 * Nothing used to stop two builds writing one database at once: a watch and a
 * build typed in another terminal, or two hooks. A build now takes
 * `<output>/build.lock` for as long as it reads and writes. The lock is
 * written whole to a file of its own and hard-linked into place, which fails
 * when one is there: two builds cannot both take it, and no build ever reads
 * another's half-written. A watch takes it for each rebuild, not for its
 * lifetime, so a build in between still runs.
 *
 * A lock whose process is gone - a crash, a killed terminal - is taken over
 * and the taking over is said: a crashed build must not lock a project for
 * ever. Whether a process is alive can only be asked on the machine it ran on,
 * so a lock from another host (a shared disk) is respected and named. One
 * process at a time takes over, under `build.lock.takeover`, and only the lock
 * it judged dead: two that find a dead lock at once must not have the second
 * clear the lock the first has just taken.
 */
export const LOCK_FILE = 'build.lock';

/** A background build waiting for the lock: the one more pass every request during a build earns. */
export const AGAIN_FILE = 'build.again';

/** Where a background build writes what it says. */
export const BUILD_LOG = 'build.log';

/** Past this the log is moved aside to `build.1.log`, so at most two are kept. */
export const BUILD_LOG_LIMIT = 1024 * 1024;

/**
 * How long a lock that cannot be read counts as one being written. A link
 * puts a lock in place whole, so only a disk with no hard links - or a build
 * that died writing on one - leaves one empty; past this it is nobody's.
 */
export const UNREADABLE_GRACE_MS = 5000;

/** Past this a takeover is one that died midway: it is a few file operations long. */
const TAKEOVER_LIMIT_MS = 30_000;

/** Past the time it was given, how long a build waits on another's takeover before it says busy. */
const TAKEOVER_WAIT_MS = 1000;

export interface LockHolder {
  pid: number;
  host: string;
  /** When it was taken, ISO. */
  startedAt: string;
}

/** A build that could not take the lock in the time it was given. */
export class BuildBusyError extends Error {
  /** Undefined when the lock could not be read: it was being written, or taken over. */
  readonly holder: LockHolder | undefined;

  constructor(holder: LockHolder | undefined) {
    super(
      holder === undefined
        ? 'a build is taking the lock'
        : `a build is running (pid ${holder.pid}${holder.host === hostname() ? '' : ` on ${holder.host}`}, since ${holder.startedAt})`,
    );
    this.name = 'BuildBusyError';
    this.holder = holder;
  }
}

const parseHolder = (text: string): LockHolder | undefined => {
  try {
    const parsed = JSON.parse(text) as Partial<LockHolder>;
    return typeof parsed.pid === 'number' && typeof parsed.host === 'string' && typeof parsed.startedAt === 'string'
      ? { pid: parsed.pid, host: parsed.host, startedAt: parsed.startedAt }
      : undefined;
  } catch {
    return undefined;
  }
};

const readHolder = (path: string): LockHolder | undefined => {
  try {
    return parseHolder(readFileSync(path, 'utf8'));
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
const isGone = (holder: LockHolder): boolean => holder.host === hostname() && !isAlive(holder.pid);

const codeOf = (cause: unknown): string | undefined => (cause as NodeJS.ErrnoException).code;

/** A name beside `path` that no other process, nor another call in this one, picks. */
const beside = (path: string, why: string): string => `${path}.${why}.${process.pid}.${randomBytes(6).toString('hex')}`;

/** What a disk that cannot hard-link answers a link with. */
const NO_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);

/** Creates `path` holding `text`, whole, unless something is there: then false. */
const createWhole = (path: string, text: string): boolean => {
  const temp = beside(path, 'new');
  writeFileSync(temp, text, { flag: 'wx' });
  try {
    linkSync(temp, path);
    return true;
  } catch (cause) {
    if (codeOf(cause) === 'EEXIST') return false;
    if (!NO_LINKS.has(codeOf(cause) ?? '')) throw cause;
  } finally {
    rmSync(temp, { force: true });
  }
  // No hard links on this disk: created empty, then written, which a reader
  // that finds it empty takes as being written (UNREADABLE_GRACE_MS).
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (cause) {
    if (codeOf(cause) === 'EEXIST') return false;
    throw cause;
  }
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
  return true;
};

/** Puts `text` at `path` in one step, over what is there. */
const replaceWhole = (path: string, text: string): void => {
  const temp = beside(path, 'new');
  writeFileSync(temp, text, { flag: 'wx' });
  renameSync(temp, path);
};

const holderText = (holder: LockHolder): string => `${JSON.stringify(holder)}\n`;

const writeNew = (path: string, holder: LockHolder): boolean => createWhole(path, holderText(holder));

/** A lock file as read once: what it says, and when it was written. */
type Seen = { state: 'free' } | { state: 'held'; holder: LockHolder; text: string; mtimeMs: number } | { state: 'unreadable'; text: string; mtimeMs: number };

type Taken = Exclude<Seen, { state: 'free' }>;

const look = (path: string): Seen => {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (cause) {
    if (codeOf(cause) === 'ENOENT') return { state: 'free' };
    throw cause;
  }
  try {
    // One open file, so the time and the words are the same file's.
    const { mtimeMs } = fstatSync(fd);
    const text = readFileSync(fd, 'utf8');
    const holder = parseHolder(text);
    return holder === undefined ? { state: 'unreadable', text, mtimeMs } : { state: 'held', holder, text, mtimeMs };
  } finally {
    closeSync(fd);
  }
};

/** Whether a lock is nobody's: its process is gone, or it has stayed unreadable too long to be one being written. */
const isAbandoned = (seen: Taken): boolean =>
  seen.state === 'held' ? isGone(seen.holder) : Date.now() - seen.mtimeMs > UNREADABLE_GRACE_MS;

const isSame = (seen: Taken, again: Seen): boolean => again.state !== 'free' && again.text === seen.text && again.mtimeMs === seen.mtimeMs;

/** Renames `path` aside, so of two processes moving it at once one finds nothing; undefined when nothing was there. */
const moveAside = (path: string): string | undefined => {
  const aside = beside(path, 'gone');
  try {
    renameSync(path, aside);
  } catch (cause) {
    if (codeOf(cause) === 'ENOENT') return undefined;
    throw cause;
  }
  return aside;
};

/**
 * Clears the abandoned lock `seen` saw at `path`, and says whether it did.
 *
 * Under a takeover lock of its own, and only while the lock is still the one
 * judged abandoned: between looking and clearing, another process may have
 * cleared it and taken it, and that lock is alive. A takeover that died
 * midway is broken after `TAKEOVER_LIMIT_MS`; the lock is checked once more
 * after it is moved aside, and put back if it turns out to be live.
 */
const clearAbandoned = (path: string, seen: Taken): boolean => {
  const guard = `${path}.takeover`;
  const mine = `${JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), nonce: randomBytes(6).toString('hex') })}\n`;
  if (!createWhole(guard, mine)) {
    const other = look(guard);
    // Another process is taking it over: the caller looks again.
    if (other.state !== 'free' && !isAbandoned(other) && Date.now() - other.mtimeMs <= TAKEOVER_LIMIT_MS) return false;
    const stuck = moveAside(guard);
    if (stuck !== undefined) rmSync(stuck, { force: true });
    if (!createWhole(guard, mine)) return false;
  }
  try {
    if (!isSame(seen, look(path))) return false;
    const aside = moveAside(path);
    if (aside === undefined) return false;
    const moved = isSame(seen, look(aside));
    if (!moved) {
      try {
        linkSync(aside, path);
      } catch {
        // Taken meanwhile: that one stands.
      }
    }
    rmSync(aside, { force: true });
    return moved;
  } finally {
    try {
      if (readFileSync(guard, 'utf8') === mine) rmSync(guard, { force: true });
    } catch {
      // Broken by another as stuck: nothing of ours to remove.
    }
  }
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
    const seen = look(path);
    if (seen.state === 'free') continue;
    if (isAbandoned(seen)) {
      if (clearAbandoned(path, seen)) {
        // A lock half-written by a build that died while writing it is nobody's to name.
        if (writeNew(path, mine)) {
          if (seen.state === 'held') tookOver = seen.holder;
          break;
        }
        continue;
      }
      // Another process is taking it over: a moment, and it is theirs or free.
      if (Date.now() >= until + TAKEOVER_WAIT_MS) throw new BuildBusyError(undefined);
      await sleep(10);
      continue;
    }
    if (Date.now() >= until) throw new BuildBusyError(seen.state === 'held' ? seen.holder : undefined);
    await sleep(Math.min(250, Math.max(10, until - Date.now())));
  }
  const text = holderText(mine);
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      // Only ours: a lock someone took over from us after a pause is theirs now.
      try {
        if (readFileSync(path, 'utf8') === text) rmSync(path, { force: true });
      } catch {
        // Gone already, or unreadable: nothing of ours to give back.
      }
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
  const seen = look(path);
  if (seen.state !== 'free' && (!isAbandoned(seen) || !clearAbandoned(path, seen))) return false;
  return writeNew(path, entry);
};

/** Names the waiting build in `build.again` once it has started, in place of the process that started it. */
export const claimAgain = (outputDir: string, from: number, pid: number): void => {
  const path = join(outputDir, AGAIN_FILE);
  const holder = readHolder(path);
  if (holder?.pid !== from) return;
  // In one step: removed and written again, another request could queue a second build in between.
  replaceWhole(path, holderText({ ...holder, pid }));
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
