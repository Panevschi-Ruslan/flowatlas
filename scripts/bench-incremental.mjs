#!/usr/bin/env node
/**
 * Measures what a one-file edit costs under `flowatlas build --watch`.
 *
 *   node scripts/bench-incremental.mjs [dir] [file] [--runs N] [--budget MS]
 *
 * Starts a watch with `--timing`, waits for the first build, then appends a
 * comment to one file over and over and reads the timing line each rebuild
 * prints. The file is restored afterwards, so running this leaves the tree as
 * it found it.
 *
 * "Under a second" is the target the plan sets, so it is measured rather than
 * asserted: the exit code is 1 when the median is over budget.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : Number(args[at + 1]);
};

const dir = resolve(root, positional[0] ?? 'fixtures/multi-repo');
const file = join(dir, positional[1] ?? 'orders/src/orders/orders.service.ts');
const runs = flag('runs', 10);
const budget = flag('budget', 1000);

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const percentile = (values, share) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * share) - 1)];
};

const original = readFileSync(file, 'utf8');
const timings = [];
let waiting;
let watching;
const ready = new Promise((done) => {
  watching = done;
});

const watch = spawn(
  process.execPath,
  [join(root, 'packages/cli/bin/flowatlas.js'), 'build', dir, '--watch', '--timing'],
  { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] },
);

let pending = '';
watch.stderr.setEncoding('utf8');
watch.stderr.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\n');
  pending = lines.pop() ?? '';
  for (const line of lines) {
    if (line.startsWith('watching ')) watching();
    if (!line.startsWith('{')) continue;
    try {
      const timing = JSON.parse(line);
      timings.push(timing);
      waiting?.(timing);
    } catch {
      // A line that is not the timing line is the human summary; ignore it.
    }
  }
});

/** Resolves with the timing line of the next rebuild, or gives up. */
const nextRebuild = (ms = 60_000) =>
  new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('no rebuild within the time allowed')), ms);
    waiting = (timing) => {
      clearTimeout(timer);
      waiting = undefined;
      done(timing);
    };
  });

const finish = (code) => {
  writeFileSync(file, original);
  watch.kill('SIGINT');
  process.exit(code);
};

try {
  await nextRebuild(180_000);
  console.log(`first build ${timings[0].total}ms`);
  // Nothing may be written until the watcher has finished its first scan: a
  // change made before that is never reported.
  await ready;

  const measured = [];
  for (let run = 1; run <= runs; run += 1) {
    const pendingRebuild = nextRebuild();
    writeFileSync(file, `${original}\n// bench ${run}\n`);
    measured.push(await pendingRebuild);
    await delay(50);
  }

  const of = (key) => measured.map((timing) => timing[key]);
  console.log(`runs ${measured.length} on ${positional[0] ?? 'fixtures/multi-repo'}`);
  console.log(`median total ${median(of('total'))}ms`);
  console.log(`p90 total ${percentile(of('total'), 0.9)}ms`);
  for (const phase of ['hash', 'extract', 'link', 'write']) {
    console.log(`median ${phase} ${median(of(phase))}ms`);
  }

  const over = median(of('total')) >= budget;
  console.log(over ? `over the ${budget}ms budget` : `under the ${budget}ms budget`);
  finish(over ? 1 : 0);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  finish(2);
}
