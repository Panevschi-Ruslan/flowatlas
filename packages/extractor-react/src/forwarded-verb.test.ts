import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/**
 * A wrapper handed the verb, and a helper whose suffix defaults to nothing
 * (P91), read by the same walk the other front-end reader and the server
 * reader take.
 */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, jsx: 4 } });
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

const labels = (graph: RepoGraph): string[] =>
  graph.nodes
    .filter((node) => node.type === 'ui_api_call')
    .map((node) => node.label)
    .sort();

describe('a verb a wrapper is handed (P91)', () => {
  it('is read at each caller its address was read at', () => {
    const graph = read({
      '/src/api.ts': `
        export const send = (method: string, path: string) => fetch(path, { method });
        export const rename = (id: string) => send('PATCH', \`/api/items/\${id}\`);
        export const remove = (id: string) => send(VERBS.remove, \`/api/items/\${id}\`);
        const VERBS = { remove: 'DELETE' } as const;
      `,
    });
    expect(labels(graph)).toEqual(['DELETE /api/items/:param', 'PATCH /api/items/:param']);
  });

  it('is read at each caller where the address is read in place', () => {
    const graph = read({
      '/src/api.ts': `
        export const sync = (method: string) => fetch('/api/sync', { method });
        export const pull = () => sync('GET');
        export const push = () => sync('POST');
      `,
    });
    expect(labels(graph)).toEqual(['GET /api/sync', 'POST /api/sync']);
  });

  it('is unread where nobody hands one in, and not taken as the default', () => {
    const graph = read({ '/src/api.ts': `export const sync = (method: string) => fetch('/api/sync', { method });` });
    expect(labels(graph)).toEqual(['? /api/sync']);
    expect(graph.unresolved.map((row) => row.reason)).toContain('api-method-dynamic');
  });
});

describe('an argument a caller leaves out (P91)', () => {
  it('is the default the helper writes', () => {
    const graph = read({
      '/src/api.ts': `
        export const items = (suffix = '') => fetch(\`/api/items\${suffix}\`);
        export const all = () => items();
        export const one = (id: string) => items(\`/\${id}\`);
      `,
    });
    expect(labels(graph)).toEqual(['GET /api/items', 'GET /api/items/:param']);
  });
});
