import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** Reads a React repository written in memory, scripts included, with nothing installed. */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, jsx: 4, allowJs: true } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react' },
    config: parseConfig({}),
    pkg: { dependencies: { react: '^19.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractReact(ctx, { noTypes: true });
  return builder.build();
};

/** Every call between two functions, as `<from> -> <to>`. */
const calls = (graph: RepoGraph): string[] => {
  const functions = new Set(graph.nodes.filter((node) => node.type === 'function').map((node) => node.id));
  return graph.edges
    .filter((edge) => edge.type === 'calls' && functions.has(edge.to))
    .map((edge) => `${edge.from.replace(/^web#/, '')} -> ${edge.to.replace(/^web#/, '')}`)
    .sort();
};

describe("a module's exports naming a function (P317)", () => {
  it('joins a call through an export that names a function by its name, in a reading of a framework as in a plain one', () => {
    const graph = read({
      '/src/api.ts': [
        "function list() { return fetch('/api/items'); }",
        "function remove(id: string) { return fetch('/api/items/' + id, { method: 'DELETE' }); }",
        'export default { list, remove: remove };',
      ].join('\n'),
      '/src/legacy.js': ["function stock() { return fetch('/api/stock'); }", 'module.exports = { stock };'].join('\n'),
      '/src/use-items.ts': [
        "import api from './api';",
        'export function useItems() { return api.list(); }',
        "export const useDrop = () => api.remove('1');",
      ].join('\n'),
      '/src/use-stock.js': ["const { stock } = require('./legacy');", 'export function useStock() { return stock(); }'].join('\n'),
    });
    expect(calls(graph)).toEqual(['src/use-items.ts:useDrop -> src/api.ts:remove', 'src/use-items.ts:useItems -> src/api.ts:list', 'src/use-stock.js:useStock -> src/legacy.js:stock']);
  });
});
