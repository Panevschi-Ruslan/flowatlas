import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { openChokidar, openProbe, type FileWatcher, type WatchDirectory } from './watch.js';
import type { WatchEventName } from './watch-surroundings.js';

/**
 * A watcher resolves once it is listening, not once it has started (R178).
 *
 * On macOS every directory watch a process holds is one stream of events, and
 * starting a watch restarts that stream a moment later on a thread of its own:
 * a change made in between reaches none of them. A watch that made a change
 * the moment it was told it was watching lost it whenever the machine was
 * busy. The probe asks the platform the one way it answers, by a change
 * reported; these cases pin what it does with the answer.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-watch-listening-')));
let dirs = 0;

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const freshDir = (): string => {
  const dir = join(scratch, `dir-${(dirs += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The number the probe last wrote into a directory, -1 before it wrote any. */
const lastWritten = (dir: string): number => {
  const at = join(dir, 'probe');
  return existsSync(at) ? Number(readFileSync(at, 'utf8')) : -1;
};

/**
 * Watches that report what a test says: the `n`th one started reports once
 * the probe has written `reportsAt[n]`, or never when that is undefined.
 */
const fakeDirectoryWatches = (
  reportsAt: ReadonlyArray<number | undefined>,
): { watchDirectory: WatchDirectory; dirs: string[]; closed: () => number } => {
  const dirsSeen: string[] = [];
  let closed = 0;
  const watchDirectory: WatchDirectory = (dir, listener) => {
    const at = reportsAt[dirsSeen.length];
    dirsSeen.push(dir);
    const timer = setInterval(() => {
      if (at !== undefined && lastWritten(dir) >= at) listener();
    }, 2);
    return {
      close: () => {
        clearInterval(timer);
        closed += 1;
      },
    };
  };
  return { watchDirectory, dirs: dirsSeen, closed: () => closed };
};

describe('the probe that says a watcher is listening', () => {
  it('writes until the watch it started reports, and says it heard', async () => {
    const fake = fakeDirectoryWatches([3]);
    const probe = openProbe({ watchDirectory: fake.watchDirectory, everyMs: 30 });
    expect(await probe.heard()).toBe(true);
    expect(lastWritten(fake.dirs[0] as string)).toBeGreaterThanOrEqual(3);
    probe.close();
  });

  it('goes on without it once its time is up, when nothing reports', async () => {
    const fake = fakeDirectoryWatches([undefined]);
    const probe = openProbe({ watchDirectory: fake.watchDirectory, everyMs: 10, withinMs: 120 });
    const started = Date.now();
    expect(await probe.heard()).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
    probe.close();
  });

  it('starts one more watch each time it is asked, and only the newest one answers', async () => {
    // The first watch keeps reporting; the one started after it never does.
    const fake = fakeDirectoryWatches([0, undefined]);
    const probe = openProbe({ watchDirectory: fake.watchDirectory, everyMs: 10, withinMs: 120 });
    expect(await probe.heard()).toBe(true);
    expect(await probe.heard()).toBe(false);
    // One directory of its own, watched twice.
    expect(fake.dirs).toHaveLength(2);
    expect(fake.dirs[1]).toBe(fake.dirs[0]);
    probe.close();
  });

  it('closes every watch it started and removes its directory when it is closed', async () => {
    const fake = fakeDirectoryWatches([0, 0]);
    const probe = openProbe({ watchDirectory: fake.watchDirectory, everyMs: 10 });
    await probe.heard();
    await probe.heard();
    expect(fake.closed()).toBe(0);
    probe.close();
    expect(fake.closed()).toBe(2);
    expect(existsSync(fake.dirs[0] as string)).toBe(false);
  });

  it('says it did not hear when it cannot start a watch, and leaves nothing behind', async () => {
    const watchDirectory: WatchDirectory = () => {
      throw new Error('no watches left');
    };
    let dir: string | undefined;
    const probe = openProbe({
      watchDirectory: (at, listener) => {
        dir = at;
        return watchDirectory(at, listener);
      },
    });
    expect(await probe.heard()).toBe(false);
    probe.close();
    expect(existsSync(dir as string)).toBe(false);
  });
});

describe('chokidar, as a watch opens it', () => {
  let watcher: FileWatcher | undefined;

  afterEach(async () => {
    await watcher?.close();
    watcher = undefined;
  });

  /** The first event for a path, however long the platform takes: the test's timeout bounds it. */
  const nextEventFor = (opened: FileWatcher, path: string): Promise<WatchEventName> =>
    new Promise((done) => {
      opened.on((event, at) => {
        if (at === path) done(event);
      });
    });

  /** A directory with enough below it that starting a watch on it starts many. */
  const tree = (): string => {
    const root = freshDir();
    for (let a = 0; a < 8; a += 1) {
      for (let b = 0; b < 8; b += 1) {
        mkdirSync(join(root, `a${a}`, `b${b}`), { recursive: true });
        writeFileSync(join(root, `a${a}`, `b${b}`, 'index.ts'), 'export {};\n');
      }
    }
    return root;
  };

  it('hears a directory made the moment it resolves', async () => {
    const root = tree();
    watcher = await openChokidar([root], () => false);
    const made = join(root, 'appeared');
    const heard = nextEventFor(watcher, made);
    mkdirSync(made);
    writeFileSync(join(made, 'package.json'), '{}\n');
    expect(await heard).toBe('addDir');
  }, 60_000);

  it('hears a directory added to it the moment the add resolves', async () => {
    const first = tree();
    const second = tree();
    watcher = await openChokidar([first], () => false);
    await watcher.add([second]);
    const made = join(second, 'appeared');
    const heard = nextEventFor(watcher, made);
    mkdirSync(made);
    expect(await heard).toBe('addDir');
  }, 60_000);

  it('lets go of a directory added to it, and goes on hearing the ones it was opened on', async () => {
    const first = freshDir();
    const second = freshDir();
    watcher = await openChokidar([first], () => false);
    await watcher.add([second]);
    watcher.unwatch([second]);
    const events: string[] = [];
    watcher.on((_event, at) => events.push(at));
    // Made in the one let go first, so that by the time the other is heard it would have been too.
    mkdirSync(join(second, 'gone'));
    await delay(50);
    const made = join(first, 'still');
    const heard = nextEventFor(watcher, made);
    mkdirSync(made);
    expect(await heard).toBe('addDir');
    await delay(200);
    expect(events).not.toContain(join(second, 'gone'));
  }, 60_000);
});
