import { resolve } from 'node:path';
import { normalizeFilePath } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import {
  countSources,
  createProject,
  listRepoSources,
  UNREADABLE_FILE_REASON,
} from '@flowatlas/core';
import { extractRepo } from './extract-repo.js';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');

/**
 * A build decides what to re-read before it parses anything, so it lists the
 * files itself. That list only means anything while it is the same one the
 * parser would have made.
 */
describe('listing the sources of a repository without parsing them', () => {
  // `react-next/shop` is in this list for the file kinds rather than for the
  // framework: it is the one fixture that mixes `.ts` handlers with `.tsx`
  // screens, and both lists have to hold both kinds or a build decides to skip
  // a repository whose only change was to a component.
  for (const name of ['nest-incremental', 'nest-basic', 'nest-leaves', 'nest-types', 'react-next/shop']) {
    it(`agrees with what the project holds for ${name}`, () => {
      const rootDir = resolve(FIXTURES, name);
      const parsed = createProject({ rootDir })
        .getSourceFiles()
        .map((sourceFile) => normalizeFilePath(sourceFile.getFilePath(), rootDir))
        .sort();
      expect(listRepoSources(rootDir)).toEqual(parsed);
    });
  }

  it('holds the markup files as well as the plain ones', () => {
    const files = listRepoSources(resolve(FIXTURES, 'react-next/shop'));
    expect(files).toContain('app/orders/page.tsx');
    expect(files).toContain('app/api/orders/route.ts');
  });

  it('is empty for a directory that holds nothing', () => {
    expect(listRepoSources(resolve(FIXTURES, 'nowhere-at-all'))).toEqual([]);
  });
});

/**
 * The count that used to say a file had been read when it had not.
 *
 * `unreadable-file` holds four sources, one of which is deliberate garbage. The
 * single `files` count said four and was the only place that file appeared at
 * all, so the figure that should have exposed the hole was the figure that hid
 * it. Opened, read and the difference are written out separately now, and the
 * difference has to agree with the rows: a subtraction nobody has to perform is
 * a subtraction nobody gets wrong.
 */
describe('counting the sources a reading could and could not read', () => {
  const rootDir = resolve(FIXTURES, 'unreadable-file');

  it('separates the files opened from the files read', () => {
    expect(countSources(createProject({ rootDir }))).toEqual({
      files: 4,
      filesRead: 3,
      filesUnreadable: 1,
    });
  });

  it('puts both figures on the repository node, one apart', async () => {
    const graph = await extractRepo({ rootDir, repo: 'unreadable-file' });
    const repoNode = graph.nodes.find((node) => node.type === 'repo');
    const stats = repoNode?.meta?.['stats'] as Record<string, number> | undefined;
    expect(stats?.['files']).toBe(4);
    expect(stats?.['filesRead']).toBe(3);
    expect(stats?.['filesUnreadable']).toBe(1);

    const rows = graph.unresolved.filter((row) => row.reason === UNREADABLE_FILE_REASON);
    expect(rows).toHaveLength(stats?.['filesUnreadable'] ?? -1);
    expect(rows[0]?.file).toBe('src/orders/broken.ts');
  });
});
