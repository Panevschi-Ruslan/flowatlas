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
  for (const name of ['nest-incremental', 'nest-basic', 'nest-leaves', 'nest-types']) {
    it(`agrees with what the project holds for ${name}`, () => {
      const rootDir = resolve(FIXTURES, name);
      const parsed = createProject({ rootDir })
        .getSourceFiles()
        .map((sourceFile) => normalizeFilePath(sourceFile.getFilePath(), rootDir))
        .sort();
      expect(listRepoSources(rootDir)).toEqual(parsed);
    });
  }

  it('is empty for a directory that holds nothing', () => {
    expect(listRepoSources(resolve(FIXTURES, 'nowhere-at-all'))).toEqual([]);
  });
});
