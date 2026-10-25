import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { builtInShapesFor } from './config.js';
import { declarationShapesOf, isDeclarationShape } from './declaration-shapes.js';
import { toPosixPath } from './ids.js';
import { countSources, createProject } from './project.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repoOf = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-shapes-')));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const SHAPE = {
  package: '@scope/stream',
  declarations: 'export declare class Stream<T> { read(): T; }',
};

const SOURCE = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: false }, include: ['src'] }),
  'src/main.ts': "import { Stream } from '@scope/stream';\nexport const s: Stream<number> = undefined;\n",
};

describe('built-in declaration shapes', () => {
  it('stands a shape in for a package that does not resolve', () => {
    const root = repoOf(SOURCE);
    const project = createProject({ rootDir: root, shapes: [SHAPE] });
    expect(declarationShapesOf(project)).toEqual(['@scope/stream']);
    const type = project.getSourceFileOrThrow('main.ts').getVariableDeclarationOrThrow('s').getType();
    expect(type.getText(undefined, 0)).toContain('Stream<number>');
    const declared = type.getSymbolOrThrow().getDeclarations()[0]?.getSourceFile().getFilePath();
    // The compiler names files with forward slashes on every OS (P199).
    expect(declared).toBe(toPosixPath(join(root, 'node_modules/@scope/stream/index.d.ts')));
  });

  it('leaves an installed package alone', () => {
    const root = repoOf({
      ...SOURCE,
      'node_modules/@scope/stream/package.json': JSON.stringify({ name: '@scope/stream', types: 'index.d.ts' }),
      'node_modules/@scope/stream/index.d.ts': 'export declare class Stream<T> { real(): T; }',
    });
    const project = createProject({ rootDir: root, shapes: [SHAPE] });
    expect(declarationShapesOf(project)).toEqual([]);
  });

  it('reads none unless a reader hands some over', () => {
    const project = createProject({ rootDir: repoOf(SOURCE) });
    expect(declarationShapesOf(project)).toEqual([]);
  });

  it('is no source file of the repository when sources are counted', () => {
    const root = repoOf(SOURCE);
    const project = createProject({ rootDir: root, shapes: [SHAPE] });
    // Asked with the OS's own spelling and with the compiler's (P199).
    expect(isDeclarationShape(project, join(root, 'node_modules/@scope/stream/index.d.ts'))).toBe(true);
    expect(isDeclarationShape(project, toPosixPath(join(root, 'node_modules/@scope/stream/index.d.ts')))).toBe(true);
    expect(countSources(project).files).toBe(1);
  });

  it('is on unless the service or the project says otherwise', () => {
    expect(builtInShapesFor(undefined, undefined)).toBe(true);
    expect(builtInShapesFor({ builtInShapes: false }, undefined)).toBe(false);
    expect(builtInShapesFor({ builtInShapes: false }, { builtInShapes: true })).toBe(true);
    expect(builtInShapesFor({}, { builtInShapes: false })).toBe(false);
  });
});
