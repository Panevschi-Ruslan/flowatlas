import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AdapterRegistry, declarationShapesOf, parseConfig, toPosixPath } from '@flowatlas/core';
import { Node } from 'ts-morph';
import { afterAll, describe, expect, it } from 'vitest';
import { registerFrontendAdapters } from '../adapter.js';
import { extractRepo, openProject } from '../extract-repo.js';

// In the system temporary directory on purpose: nothing is installed above it,
// which is the case the shapes are for.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-angular-shapes-')));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'storefront',
    dependencies: { '@angular/core': '^19', '@angular/common': '^19', rxjs: '^7' },
  }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: { experimentalDecorators: true, strict: true },
    include: ['src'],
  }),
  'src/basket.service.ts': `
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

export interface Basket { id: string; total: number }

@Injectable({ providedIn: 'root' })
export class BasketService {
  private readonly http = inject(HttpClient);

  load(id: string): Observable<Basket> {
    return this.http.get<Basket>('/baskets/' + id);
  }

  total(id: string) {
    return this.http.get<Basket>('/baskets/' + id).pipe(map((basket) => basket.total));
  }
}
`,
};

for (const [path, text] of Object.entries(FILES)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const configOf = (builtInShapes?: boolean) => parseConfig(builtInShapes === undefined ? {} : { builtInShapes });

const read = (builtInShapes?: boolean) =>
  extractRepo({
    rootDir: root,
    repo: 'storefront',
    config: configOf(builtInShapes),
    registry: registerFrontendAdapters(new AdapterRegistry()),
  });

const calls = async (builtInShapes?: boolean) =>
  (await read(builtInShapes)).nodes.filter((node) => node.type === 'ui_api_call');

describe('built-in shapes for an Angular application with nothing installed', () => {
  it('stand in for the stream library and the framework packages, unless turned off', () => {
    const open = (builtInShapes?: boolean) => openProject({ rootDir: root, repo: 'storefront', config: configOf(builtInShapes) });
    expect(declarationShapesOf(open())).toEqual(['@angular/common/http', '@angular/core', 'rxjs']);
    expect(declarationShapesOf(open(false))).toEqual([]);
  });

  it('reads no request without them', async () => {
    expect(await calls(false)).toEqual([]);
  });

  it('reads the requests made with the injected client', async () => {
    const found = await calls();
    expect(found.map((call) => String(call.meta?.['method']))).toEqual(['GET', 'GET']);
  });

  it('resolves a stream and what a pipe turns it into', () => {
    const project = openProject({ rootDir: root, repo: 'storefront', config: configOf() });
    const service = project.getSourceFileOrThrow(join(root, 'src/basket.service.ts')).getClassOrThrow('BasketService');
    const returnOf = (name: string) => {
      const method = service.getMethodOrThrow(name);
      return method.getReturnType().getText(method);
    };
    expect(returnOf('load')).toBe('Observable<Basket>');
    expect(returnOf('total')).toBe('Observable<number>');
    const pipe = service.getMethodOrThrow('total').getDescendants().find(
      (node) => Node.isPropertyAccessExpression(node) && node.getName() === 'pipe',
    );
    // The compiler names files with forward slashes on every OS (P199).
    expect(pipe?.getSymbol()?.getDeclarations()[0]?.getSourceFile().getFilePath()).toBe(toPosixPath(join(root, 'node_modules/rxjs/index.d.ts')));
  });

  it('writes no shape file into the repository, and counts none as a source', async () => {
    const graph = await read();
    // The client is drawn as its package, as an installed one is, never as the shape's file.
    expect(graph.nodes.some((node) => node.file?.endsWith('.d.ts'))).toBe(false);
    expect(graph.nodes.find((node) => node.label === 'HttpClient')?.file).toBe('node_modules/@angular/common');
    const repoNode = graph.nodes.find((node) => node.type === 'repo');
    expect((repoNode?.meta?.['stats'] as { files?: number } | undefined)?.files).toBe(1);
  });
});
