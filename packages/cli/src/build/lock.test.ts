import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { acquireBuildLock, AGAIN_FILE, BuildBusyError, claimAgain, isAlive, leaveQueue, LOCK_FILE, queueAgain } from './lock.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-lock-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
const outputDir = (): string => {
  const dir = join(scratch, `out-${(n += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** A pid no process has: far past what a system hands out. */
const DEAD = 2 ** 22 + 12345;

describe('one build at a time (P230)', () => {
  it('lets one build hold the lock, refuses a second naming the first, and lets go', async () => {
    const dir = outputDir();
    const first = await acquireBuildLock(dir);
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'))).toMatchObject({ pid: process.pid, host: hostname() });
    const second = await acquireBuildLock(dir).catch((error: unknown) => error);
    expect(second).toBeInstanceOf(BuildBusyError);
    expect((second as Error).message).toMatch(new RegExp(`^a build is running \\(pid ${process.pid}, since `));
    first.release();
    first.release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });

  it('waits for a build that holds it, when told to', async () => {
    const dir = outputDir();
    const first = await acquireBuildLock(dir);
    setTimeout(() => first.release(), 150);
    const second = await acquireBuildLock(dir, 5000);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
    second.release();
  });

  it('takes over a lock whose process is gone, and says whose it was', async () => {
    const dir = outputDir();
    expect(isAlive(DEAD)).toBe(false);
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: DEAD, host: hostname(), startedAt: 'earlier' }));
    const lock = await acquireBuildLock(dir);
    expect(lock.tookOver).toEqual({ pid: DEAD, host: hostname(), startedAt: 'earlier' });
    lock.release();
  });

  it('respects a lock from another host, which it cannot ask about', async () => {
    const dir = outputDir();
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: DEAD, host: 'another-machine', startedAt: 'earlier' }));
    const refused = await acquireBuildLock(dir).catch((error: unknown) => error);
    expect((refused as Error).message).toContain('on another-machine');
  });
});

describe('a background build queued once however often it is asked (P230 D4)', () => {
  it('queues the first request, and lets the rest find it waiting until it takes the lock', () => {
    const dir = outputDir();
    expect(queueAgain(dir, process.pid)).toBe(true);
    expect(queueAgain(dir, process.pid)).toBe(false);
    claimAgain(dir, process.pid, process.ppid);
    expect(JSON.parse(readFileSync(join(dir, AGAIN_FILE), 'utf8')).pid).toBe(process.ppid);
    leaveQueue(dir, process.ppid);
    expect(existsSync(join(dir, AGAIN_FILE))).toBe(false);
    expect(queueAgain(dir, process.pid)).toBe(true);
  });

  it('queues again over a waiting build that is gone', () => {
    const dir = outputDir();
    writeFileSync(join(dir, AGAIN_FILE), JSON.stringify({ pid: DEAD, host: hostname(), startedAt: 'earlier' }));
    expect(queueAgain(dir, process.pid)).toBe(true);
  });
});
