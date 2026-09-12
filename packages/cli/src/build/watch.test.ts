import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openGraphDb } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuildResult } from '../commands/build.js';
import { watchProject, type WatchHandle } from './watch.js';

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');
const FIXTURE = join(FIXTURES, 'nest-incremental');
const SERVICE = 'src/orders/orders.service.ts';

// Beside the fixtures, so the copy still resolves the packages hoisted there.
const scratch = mkdtempSync(join(FIXTURES, '.scratch-watch-'));
const repoDir = join(scratch, 'orders');
const configPath = join(scratch, 'flowatlas.config.json');

const rebuilds: BuildResult[] = [];
let handle: WatchHandle;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until the watch has gone quiet and stayed quiet.
 *
 * `settled` can only see a rebuild that is running, queued, or waiting out the
 * debounce. An event the kernel has not delivered yet is none of those, and
 * there is a tenth of a second between a save landing and the watch hearing
 * about it, so `settled` on its own answers "nothing is happening" to a save
 * that has just been made. Quiet is settled twice over, a quarter of a second
 * apart, which is longer than that gap.
 */
const quiet = async (): Promise<void> => {
  const until = Date.now() + 30_000;
  for (;;) {
    await handle.settled();
    const count = rebuilds.length;
    await delay(250);
    await handle.settled();
    if (rebuilds.length === count || Date.now() > until) return;
  }
};

/**
 * The rebuilds a save earned, once the watch has gone quiet again.
 *
 * A save is not always one event: under load one `writeFileSync` reaches the
 * watcher twice, three times in five hundred and fifty saves as measured here.
 * Chokidar holds a save open until its size has been still for
 * `stabilityThreshold`, then emits it and forgets it, so a second report of the
 * same save arriving after that is emitted again. It arrives while the rebuild
 * answering the first is still running, so it earns a rebuild of its own, which
 * looks at the file, finds the content it already read, and truthfully answers
 * `skip`. Every failure reproduced under load had that shape.
 *
 * So the last rebuild after a save is not necessarily the one that read it, and
 * a test that waits for a count and then reads the last one is asserting
 * something no watcher can promise. What it can promise is that exactly one of
 * the rebuilds a save earns has read the save, and that any others found
 * nothing to do and said so.
 */
const rebuildsAfter = async (before: number): Promise<BuildResult[]> => {
  const until = Date.now() + 30_000;
  while (rebuilds.length <= before && Date.now() < until) await delay(25);
  await quiet();
  return rebuilds.slice(before);
};

/** What every rebuild that did not read anything must have said. */
const NOTHING_CHANGED = { mode: 'skip', reason: '0 files changed' };

const touch = (text: string): void => {
  const path = join(repoDir, SERVICE);
  writeFileSync(path, `${readFileSync(path, 'utf8')}\n// ${text}\n`);
};

/**
 * The service with one more method on it, written from the fixture each time.
 *
 * A comment says nothing about whether a save was read; a method is a node, so
 * the graph on disk answers it.
 */
const withMethod = (name: string): string => {
  const base = readFileSync(join(FIXTURE, SERVICE), 'utf8');
  const close = base.lastIndexOf('}');
  const method = `\n  ${name}(id: string): OrderDto {\n    return this.orders.find(id);\n  }\n`;
  return `${base.slice(0, close)}${method}${base.slice(close)}`;
};

beforeAll(async () => {
  mkdirSync(repoDir, { recursive: true });
  cpSync(FIXTURE, repoDir, { recursive: true });
  rmSync(join(repoDir, '.flowatlas'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(join(repoDir, 'edits'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  writeFileSync(
    configPath,
    JSON.stringify({
      services: [{ name: 'orders', repo: './orders', type: 'nestjs' }],
      output: '.flowatlas',
    }),
  );
  handle = await watchProject({
    config: configPath,
    debounceMs: 40,
    print: () => {},
    onRebuild: (result) => rebuilds.push(result),
  });
}, 120_000);

afterAll(async () => {
  await handle?.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('watching a project', () => {
  it('builds once before it starts watching', () => {
    expect(rebuilds).toHaveLength(1);
    expect(rebuilds[0]?.plan['orders']?.mode).toBe('full');
  });

  it('rebuilds after a change, re-reading the file and the ones importing it', async () => {
    const before = rebuilds.length;
    touch('one');
    const after = await rebuildsAfter(before);

    const read = after.filter((result) => result.plan['orders']?.mode === 'partial');
    expect(read).toHaveLength(1);
    expect(read[0]?.timing.files).toContain(`orders:${SERVICE}`);
    for (const result of after) {
      if (result === read[0]) continue;
      expect(result.plan['orders']).toEqual(NOTHING_CHANGED);
    }
  }, 60_000);

  it('answers a burst of saves with the rebuild that follows the last of them', async () => {
    const before = rebuilds.length;
    touch('two');
    touch('three');
    touch('four');
    const after = await rebuildsAfter(before);

    // One rebuild for the burst, and at most one more for a save that landed
    // while that one was running.
    const read = after.filter((result) => result.plan['orders']?.mode !== 'skip');
    expect(read.length).toBeGreaterThanOrEqual(1);
    expect(read.length).toBeLessThanOrEqual(2);
    expect(readFileSync(join(repoDir, SERVICE), 'utf8')).toContain('// four');
  }, 60_000);

  it('re-reads a save that landed while it was reading the last one', async () => {
    const before = rebuilds.length;
    writeFileSync(join(repoDir, SERVICE), withMethod('six'));
    // Long enough for the rebuild answering the first save to have started,
    // short enough to still be inside it. A file stamped after it was read
    // rather than before records this second save as read, so the next rebuild
    // answers `0 files changed` and the save is never in the graph at all. One
    // in five of the saves that landed inside a rebuild went that way.
    await delay(120);
    writeFileSync(join(repoDir, SERVICE), withMethod('seven'));
    await rebuildsAfter(before);

    const graph = readFileSync(join(repoDir, '.flowatlas', 'graph.json'), 'utf8');
    expect(graph).toContain('OrdersService.seven');
  }, 60_000);

  it('never shows a reader a database that is half written', async () => {
    const dbPath = join(scratch, '.flowatlas', 'graph.db');
    const before = rebuilds.length;
    let opened = 0;
    let stop = false;

    const reading = (async () => {
      while (!stop) {
        const db = openGraphDb(dbPath);
        // A database caught mid-write would have no rows and no schema version.
        expect(db.schemaVersion()).toBeGreaterThan(0);
        expect(db.counts().nodes).toBeGreaterThan(0);
        db.close();
        opened += 1;
        await delay(5);
      }
    })();

    touch('five');
    await rebuildsAfter(before);
    stop = true;
    await reading;
    expect(opened).toBeGreaterThan(0);
  }, 60_000);

  it('leaves no half-written file behind when it is stopped', async () => {
    await quiet();
    const output = readdirSync(join(scratch, '.flowatlas'));
    expect(output.filter((name) => name.endsWith('.tmp') || name.endsWith('.building'))).toEqual([]);
    expect(output).toContain('project-graph.json');
    expect(output).toContain('graph.db');
    expect(output).toContain('cache.json');
  }, 60_000);
});
