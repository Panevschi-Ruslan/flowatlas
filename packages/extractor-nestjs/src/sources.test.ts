import { resolve } from 'node:path';
import { normalizeFilePath } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { createProject, listRepoSources } from '@flowatlas/core';

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
