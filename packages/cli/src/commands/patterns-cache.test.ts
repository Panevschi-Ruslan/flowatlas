import { appendFileSync, cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadBuildCache } from '../build/cache.js';
import { buildProject, type BuildResult } from './build.js';

/**
 * A pattern file is configuration the readers compile (P121), and joins the
 * stand-ins fingerprint of P83: a new file under a listed glob, an edited one
 * and a removed one each read the services that list them again, though no
 * file of a repository and no key of the configuration changed.
 */

const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/house-patterns');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-patterns-cache-')));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const copyOfFixture = (): string => {
  const dir = join(scratch, 'copy');
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, '.flowatlas'), { recursive: true, force: true });
  rmSync(join(dir, 'variants'), { recursive: true, force: true });
  return dir;
};

const build = (root: string): Promise<BuildResult> => buildProject({ config: join(root, 'flowatlas.config.json'), builtAt: FIXED });

const producersOf = (result: BuildResult): number =>
  (JSON.parse(readFileSync(join(result.outputDir, 'project-graph.json'), 'utf8')) as { nodes: Array<{ type: string }> }).nodes.filter(
    (node) => node.type === 'producer',
  ).length;

describe('a cached graph whose pattern files moved', () => {
  it('records the files, and reads the services again as each is added, changed and removed', async () => {
    const root = copyOfFixture();
    const first = await build(root);
    const loaded = loadBuildCache(first.cachePath);
    if (loaded === null || 'problem' in loaded) throw new Error('no cache');
    expect(loaded.cache.repos['catalog']?.standIns?.patterns).toEqual({ 'flowatlas-patterns/house.yml': expect.stringMatching(/^sha1:/) });
    expect(producersOf(first)).toBe(2);

    const still = await build(root);
    expect(still.plan['catalog']).toEqual({ mode: 'skip', reason: '0 files changed' });

    writeFileSync(join(root, 'flowatlas-patterns', 'extra.yml'), '[]\n');
    const added = await build(root);
    expect(added.plan['catalog']).toEqual({ mode: 'full', reason: 'stand-ins changed: pattern file flowatlas-patterns/extra.yml added' });

    appendFileSync(join(root, 'flowatlas-patterns', 'extra.yml'), '# a comment\n');
    const changed = await build(root);
    expect(changed.plan['stock']).toEqual({ mode: 'full', reason: 'stand-ins changed: pattern file flowatlas-patterns/extra.yml changed' });

    rmSync(join(root, 'flowatlas-patterns', 'extra.yml'));
    rmSync(join(root, 'flowatlas-patterns', 'house.yml'));
    const removed = await build(root);
    expect(removed.plan['catalog']?.mode).toBe('full');
    expect(removed.plan['catalog']?.reason).toMatch(/^stand-ins changed: pattern file flowatlas-patterns\/(extra|house)\.yml removed$/);
    expect(producersOf(removed)).toBe(0);
  }, 180_000);
});
