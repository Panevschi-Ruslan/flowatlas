import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProject } from '../commands/build.js';
import { runExtract } from '../commands/extract.js';

/**
 * The repositories whose Terraform was evaluated, once per evaluation.
 *
 * Counted where the reader's evaluation begins, inside the compiled reader the
 * command runs: the reading is asked for from several places in one build, and
 * only the evaluation says whether each of them read the files again.
 */
const evaluated = vi.hoisted(() => [] as string[]);

vi.mock('../../../terraform/dist/configuration/load.js', async (importOriginal) => {
  const actual = await importOriginal<{ loadConfiguration: (options: { repoDir: string }) => unknown }>();
  return {
    ...actual,
    loadConfiguration: (options: { repoDir: string }) => {
      evaluated.push(options.repoDir);
      return actual.loadConfiguration(options);
    },
  };
});

const ROOT = resolve(import.meta.dirname, '../../../..');
const NEUTRAL = join(ROOT, 'scripts', 'fixture.config.json');
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-deployment-reading-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const copyOf = (name: string): string => {
  const dir = join(scratch, name);
  cpSync(join(ROOT, 'fixtures', name), dir, { recursive: true, filter: (from) => !from.split(sep).includes('.flowatlas') });
  return dir;
};

/** How many times each repository's Terraform was evaluated. */
const timesEach = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const dir of evaluated) counts[dir] = (counts[dir] ?? 0) + 1;
  return counts;
};

/**
 * A service's deployment is asked for its source roots, for the files a build
 * stamps and for its entries; all of them are one evaluation of its Terraform
 * (R176).
 */
describe('one Terraform reading per lambda service', () => {
  beforeEach(() => {
    evaluated.length = 0;
  });

  it('reads each service once in a build, and none again in a build with nothing changed', async () => {
    const dir = copyOf('multi-repo-lambda');
    const config = join(dir, 'flowatlas.config.json');
    await buildProject({ config, builtAt: '2026-01-01T00:00:00.000Z' });
    expect(timesEach()).toEqual({ [join(dir, 'holds')]: 1, [join(dir, 'loans')]: 1, [join(dir, 'platform')]: 1 });

    evaluated.length = 0;
    await buildProject({ config, builtAt: '2026-01-01T00:00:00.000Z' });
    expect(timesEach()).toEqual({});
  }, 120_000);

  it('reads a repository once in an extract', async () => {
    const dir = copyOf('lambda-functions-beside-src');
    await runExtract(dir, { config: NEUTRAL, cache: false });
    expect(timesEach()).toEqual({ [dir]: 1 });
  }, 120_000);
});
