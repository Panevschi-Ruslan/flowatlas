import { Project, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { evaluationOrder } from './module-order.js';

/** A project of the files given, in memory. */
const projectOf = (files: Record<string, string>): Project => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  return project;
};

const file = (project: Project, path: string): SourceFile => project.getSourceFileOrThrow(path);

/** The modules given in the order found, by name, or the reason none is. */
const ordered = (project: Project, paths: readonly string[]): string[] | string => {
  const found = evaluationOrder(paths.map((path) => file(project, path)));
  if ('why' in found) return found.why;
  return [...paths].sort((a, b) => (found.order.get(file(project, a)) ?? 0) - (found.order.get(file(project, b)) ?? 0)).map((path) => path.split('/').pop() as string);
};

describe('the order modules are evaluated in (P355)', () => {
  it("walks the static imports from the one entry point depth first, a module's imports before itself, each once", () => {
    const project = projectOf({
      '/repo/src/main.ts': "import './a';\nimport './b';",
      '/repo/src/a.ts': "import './c';\nimport type { T } from './d';\nexport const a = 1;",
      '/repo/src/c.ts': "import { a } from './a';\nexport const c = a;",
      '/repo/src/d.ts': 'export type T = 1;\nexport const d = 1;',
      '/repo/src/b.ts': "export * from './d';",
      // A test importing a module is no entry point.
      '/repo/src/b.test.ts': "import './b';",
    });
    expect(ordered(project, ['/repo/src/b.ts', '/repo/src/c.ts', '/repo/src/a.ts', '/repo/src/d.ts'])).toEqual(['c.ts', 'a.ts', 'd.ts', 'b.ts']);
  });

  it('says why where a module is loaded by a dynamic import(), or reached from two entry points', () => {
    const project = projectOf({
      '/repo/src/main.ts': "import './a';\nexport const load = () => import('./late');",
      '/repo/src/admin.ts': "import './b';",
      '/repo/src/a.ts': 'export const a = 1;',
      '/repo/src/b.ts': 'export const b = 1;',
      '/repo/src/late.ts': "import './inner';",
      '/repo/src/inner.ts': 'export const inner = 1;',
    });
    expect(ordered(project, ['/repo/src/a.ts', '/repo/src/late.ts'])).toBe('late.ts is loaded only by a dynamic import(), at a time not known');
    expect(ordered(project, ['/repo/src/a.ts', '/repo/src/inner.ts'])).toBe('inner.ts is reached only through late.ts, which a dynamic import() loads at a time not known');
    expect(ordered(project, ['/repo/src/a.ts', '/repo/src/b.ts'])).toBe(
      'the modules adding to it are reached from 2 entry points (admin.ts, main.ts), whose order depends on which one is loaded',
    );
  });
});
