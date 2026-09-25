import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AdapterRegistry, type ExtractContext, type FrontendAdapter } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { extractRepo } from './extract-repo.js';

// Beside the fixtures rather than in the system temporary directory, for the
// same reason the incremental tests are: a repository anywhere else resolves
// none of the packages hoisted next to them.
const scratch = mkdtempSync(resolve(import.meta.dirname, '../../../fixtures/.scratch-halves-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A repository that is a browser and a server in one directory, as far as this
 * test is concerned: a handler in `.ts` and a screen in `.tsx`.
 */
const repoDir = ((): string => {
  writeFileSync(join(scratch, 'package.json'), '{ "name": "halves", "dependencies": {} }\n');
  writeFileSync(join(scratch, 'handler.ts'), 'export const GET = async (): Promise<number> => 1;\n');
  writeFileSync(join(scratch, 'screen.tsx'), 'export const Screen = () => null;\n');
  return scratch;
})();

/**
 * A frontend adapter that reads nothing and records what it was given.
 *
 * Written here rather than taken from a real extractor on purpose: what this
 * test is about is the contract, and a fake that satisfies the contract proves
 * the server reader hands the browser half a usable context without naming any
 * framework to do it.
 */
const spy = (): { adapter: FrontendAdapter; seen: string[] } => {
  const seen: string[] = [];
  const adapter: FrontendAdapter = {
    name: 'spy',
    detect: () => true,
    extract: (ctx: ExtractContext) => {
      for (const file of ctx.project.getSourceFiles()) seen.push(file.getBaseName());
      ctx.builder.addNode({
        id: `repo:${ctx.repo}`,
        type: 'repo',
        label: ctx.repo,
        repo: ctx.repo,
        meta: { stats: { files: seen.length, skippedExternalCalls: { 'a-package': 2 } } },
      });
    },
  };
  return { adapter, seen };
};

describe('a repository read by both halves at once', () => {
  it('opens both file kinds and hands them to the frontend adapter the registry found', async () => {
    const { adapter, seen } = spy();
    const registry = new AdapterRegistry().register('frontend', adapter);
    await extractRepo({ rootDir: repoDir, repo: 'halves', registry });
    expect(seen).toContain('handler.ts');
    expect(seen).toContain('screen.tsx');
  });

  it('keeps one repository node holding what both halves counted', async () => {
    const { adapter } = spy();
    const registry = new AdapterRegistry().register('frontend', adapter);
    const graph = await extractRepo({ rootDir: repoDir, repo: 'halves', registry });
    const repoNodes = graph.nodes.filter((node) => node.type === 'repo');
    expect(repoNodes).toHaveLength(1);
    const stats = repoNodes[0]?.meta?.['stats'] as Record<string, unknown>;
    // The server half's own counter is there beside the browser half's, and the
    // two records of calls into installed packages were added rather than one
    // of them replacing the other.
    expect(stats['classes']).toBe(0);
    expect(stats['skippedExternalCalls']).toEqual({ 'a-package': 2 });
  });

  it('reads a repository no frontend adapter recognises exactly as before', async () => {
    const graph = await extractRepo({ rootDir: repoDir, repo: 'halves' });
    expect(graph.nodes.filter((node) => node.type === 'repo')).toHaveLength(1);
  });
});
