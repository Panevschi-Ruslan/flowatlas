import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { inRepo, repoRelativeOf, sourceFileIn } from './repo-paths.js';

describe('repository paths on any platform', () => {
  it('reads a path with forward slashes under a directory written with backslashes, as on Windows', () => {
    expect(repoRelativeOf('D:\\a\\shop', 'D:/a/shop/src/orders.ts')).toBe('src/orders.ts');
    expect(repoRelativeOf('D:\\a\\shop', 'D:\\a\\shop\\src\\orders.ts')).toBe('src/orders.ts');
    expect(inRepo('D:\\a\\shop', 'D:/a/shop/src/orders.ts')).toBe(true);
  });

  it('keeps a path outside the repository as it is, and never matches a directory that only starts the same', () => {
    expect(repoRelativeOf('/a/shop', '/a/shopfront/src/x.ts')).toBe('/a/shopfront/src/x.ts');
    expect(inRepo('/a/shop', '/a/shopfront/src/x.ts')).toBe(false);
  });

  it('finds a file of an in-memory project rooted at the directory as given, or at the root', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/web/src/a.ts', 'export const a = 1;');
    project.createSourceFile('/src/b.ts', 'export const b = 1;');
    expect(sourceFileIn(project, '/web', 'src/a.ts')?.getBaseName()).toBe('a.ts');
    expect(sourceFileIn(project, '/', 'src/b.ts')?.getBaseName()).toBe('b.ts');
    expect(sourceFileIn(project, '/web', 'src/missing.ts')).toBeUndefined();
  });
});
