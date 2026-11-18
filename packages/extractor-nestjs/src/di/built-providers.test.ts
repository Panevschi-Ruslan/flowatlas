import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type RepoGraph } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { extractRepo } from '../extract-repo.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A service of the files given, beside a package manifest and a compiler configuration. */
const read = (files: Record<string, string>): Promise<RepoGraph> => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-nest-built-')));
  roots.push(root);
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'worker', dependencies: { '@nestjs/common': '^11' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { experimentalDecorators: true, strict: false }, include: ['src'] }),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return extractRepo({ rootDir: root, repo: 'worker', config: parseConfig({}) });
};

/** Each call between methods, as `<from> -> <to>`. */
const calls = (graph: RepoGraph): string[] => {
  const label = (id: string): string => graph.nodes.find((node) => node.id === id)?.label ?? id;
  return graph.edges.filter((edge) => edge.type === 'calls').map((edge) => `${label(edge.from)} -> ${label(edge.to)}`).sort();
};

describe('providers a function builds, and a value made with new (P349)', () => {
  it('reads the list a function answers with, draws a call on a useValue: new X() token to X, and says a list built at run time', async () => {
    const graph = await read({
      'src/readers.module.ts': `
import { Inject, Injectable, Module } from '@nestjs/common';
export class Reader { read(path: string) { return path; } }
@Injectable()
export class Levels {
  constructor(@Inject('LEVELS') private readonly reader) {}
  run() { return this.reader.read('/levels'); }
}
@Injectable()
export class Mirror {
  constructor(@Inject('MIRROR') private readonly reader) {}
  run() { return this.reader.read('/mirror'); }
}
function moreProviders() {
  return [Levels, { provide: 'LEVELS', useValue: new Reader() }, { provide: 'MIRROR', useExisting: 'LEVELS' }];
}
const registered = new Set<unknown>();
const loaded = () => Array.from(registered);
@Module({ providers: [...moreProviders(), Mirror, ...loaded()] })
export class ReadersModule {}
`,
    });
    expect(calls(graph)).toEqual(['Levels.run -> Reader.read', 'Mirror.run -> Reader.read']);
    expect(graph.unresolved.filter((row) => row.reason === 'call-through-token')).toEqual([]);
    const unread = graph.unresolved.filter((row) => row.reason === 'module-providers-unread').map((row) => row.symbol);
    expect(unread).toEqual(['ReadersModule providers loaded()']);
  });
});
