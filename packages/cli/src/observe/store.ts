import { closeSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { observedPathFor, readObserved, type Observed, type ObservedRead } from '@flowatlas/core';

export { OBSERVED_FILE, observedPathFor } from '@flowatlas/core';

/** The observed file beside a database, and why there is none when it is there and cannot be read. */
export const readObservedBeside = (dbPath: string): ObservedRead => {
  const read = readObserved(observedPathFor(dbPath));
  return read.problem?.kind === 'missing' ? {} : read;
};

/** The observed file beside a database, or nothing when there is none or it cannot be read. */
export const loadObserved = (dbPath: string): Observed | undefined => readObservedBeside(dbPath).observed;

/**
 * Writes the observed file beside a database: to a temporary file first, then
 * renamed over it, so a page, the graph server or a second reader never sees
 * half a file (P109).
 */
export const saveObserved = (dbPath: string, observed: Observed): string => {
  const path = observedPathFor(dbPath);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(observed, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
  } catch (cause) {
    rmSync(temporary, { force: true });
    throw cause;
  }
  return path;
};

// --- one writer ----------------------------------------------------------------

/** Held, with the holder's pid inside, by whatever writes the observed file: a listener for as long as it runs. */
export const OBSERVED_LOCK = 'observed.lock';

/** How long `observe <files>` waits for the lock before it says who holds it. */
export const LOCK_WAIT_MS = 5_000;

const RETRY_MS = 100;

/** The lock is held by another process that is still running. */
export class ObservedLocked extends Error {
  constructor(
    readonly path: string,
    readonly pid: number,
  ) {
    super(`${path} is held by process ${pid}`);
    this.name = 'ObservedLocked';
  }
}

const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Whether a process of this pid is running; one this user may not signal is running too. */
const running = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** What the lock file says: a pid, nothing yet (being written), or something no lock writes (stale). */
const holderOf = (path: string): number | 'empty' | 'gone' | 'stale' => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8').trim();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 'gone';
    throw cause;
  }
  if (text === '') return 'empty';
  return /^\d+$/.test(text) ? Number(text) : 'stale';
};

export interface LockOptions {
  /** How long to wait for a holder that is running (default `LOCK_WAIT_MS`). */
  waitMs?: number;
}

/**
 * Takes `.flowatlas/observed.lock` in `dir`, waiting up to `waitMs` for a
 * holder that is still running; a lock whose process is gone is taken over.
 * Gives back the release, which removes the file only while it is still this
 * process's. A directory that is not there has no file to protect: nothing is
 * created, and the write that follows says what is missing.
 */
export const acquireObservedLock = (dir: string, options: LockOptions = {}): (() => void) => {
  const path = join(dir, OBSERVED_LOCK);
  const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS);
  let emptySeen = 0;
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(path, 'wx');
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return () => {};
      if (code !== 'EEXIST') throw cause;
    }
    if (fd !== undefined) {
      try {
        writeSync(fd, `${process.pid}\n`);
      } finally {
        closeSync(fd);
      }
      return () => {
        if (holderOf(path) === process.pid) rmSync(path, { force: true });
      };
    }
    const holder = holderOf(path);
    if (holder === 'gone') continue;
    // A holder that wrote nothing for a while died between creating the file and writing its pid.
    if (holder === 'empty') emptySeen += 1;
    if (holder === 'stale' || (typeof holder === 'number' && !running(holder)) || emptySeen > 10) {
      try {
        unlinkSync(path);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }
      emptySeen = 0;
      continue;
    }
    if (Date.now() >= deadline) throw new ObservedLocked(path, typeof holder === 'number' ? holder : 0);
    pause(RETRY_MS);
  }
};

/** Runs `fn` holding the observed file's lock in `dir` (see `acquireObservedLock`). */
export const withObservedLock = <T>(dir: string, fn: () => T, options: LockOptions = {}): T => {
  const release = acquireObservedLock(dir, options);
  try {
    return fn();
  } finally {
    release();
  }
};
