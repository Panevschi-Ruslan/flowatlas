import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { acquireBuildLock, AGAIN_FILE, BuildBusyError, claimAgain, isAlive, leaveQueue, LOCK_FILE, queueAgain, UNREADABLE_GRACE_MS } from './lock.js';

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

  it('takes a lock still being written as busy, and one left empty long ago as nobody', async () => {
    const dir = outputDir();
    writeFileSync(join(dir, LOCK_FILE), '');
    const busy = await acquireBuildLock(dir).catch((error: unknown) => error);
    expect(busy).toBeInstanceOf(BuildBusyError);
    expect((busy as BuildBusyError).message).toBe('a build is taking the lock');
    const long = new Date(Date.now() - UNREADABLE_GRACE_MS - 1000);
    utimesSync(join(dir, LOCK_FILE), long, long);
    const lock = await acquireBuildLock(dir);
    expect(lock.tookOver).toBeUndefined();
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).pid).toBe(process.pid);
    lock.release();
  });

  it('lets one of many processes racing for it hold it at a time, over no lock and over a dead one', async () => {
    const child = join(scratch, 'race.mjs');
    writeFileSync(
      child,
      [
        `import { acquireBuildLock } from ${JSON.stringify(new URL('./lock.ts', import.meta.url).href)};`,
        "import { rmSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        'const [dir, start] = [process.argv[2], Number(process.argv[3])];',
        'while (Date.now() < start) {}',
        'let lock;',
        "try { lock = await acquireBuildLock(dir, 0); } catch (error) { console.log(error.name === 'BuildBusyError' ? 'busy' : `error ${error.message}`); process.exit(0); }",
        // A second holder finds the first one's mark: two inside at once.
        "try { writeFileSync(join(dir, 'inside'), String(process.pid), { flag: 'wx' }); } catch { console.log('overlap'); process.exit(0); }",
        'const until = Date.now() + 150; while (Date.now() < until) {}',
        "rmSync(join(dir, 'inside'));",
        'lock.release();',
        "console.log('held');",
      ].join('\n'),
    );
    const race = async (dir: string): Promise<string[]> => {
      const start = Date.now() + 1500;
      const runs = Array.from({ length: 12 }, () => {
        const proc = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', child, dir, String(start)], {
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        let out = '';
        proc.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
        return new Promise<string>((done) => proc.on('close', () => done(out.trim())));
      });
      return Promise.all(runs);
    };
    for (const dead of [false, true]) {
      const dir = outputDir();
      if (dead) writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: DEAD, host: hostname(), startedAt: 'earlier' }));
      const said = await race(dir);
      expect(said.filter((line) => line !== 'busy' && line !== 'held')).toEqual([]);
      expect(said.filter((line) => line === 'held').length).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
      // Nothing left beside it: no lock half-made, none moved aside, no takeover.
      expect(readdirSync(dir)).toEqual([]);
    }
  }, 30_000);

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
