import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type ExtractContext,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/**
 * The row a request rooted at an undeclared settings key leaves, from this reader.
 *
 * `api-base-unknown` is written by three readers and was held by a test of one
 * of them, the Angular request client. Kept apart from `read.test.ts` so that it
 * survives the changes being made to this reader elsewhere.
 */
const read = (files: Record<string, string>, service: Partial<ServiceConfig>): RepoGraph => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false, jsx: 4 },
  });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react', ...service },
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

const API = {
  '/src/api.ts': [
    'const base = import.meta.env.VITE_API_URL;',
    'export const listOrders = () => fetch(`${base}/api/orders`);',
    '',
  ].join('\n'),
};

const reasons = (graph: RepoGraph): string[] => graph.unresolved.map((row) => row.reason);

describe('a request rooted at a settings key the service does not declare', () => {
  it('asks for the key to be declared, at the call', () => {
    const graph = read(API, { apiBaseEnv: ['VITE_OTHER_URL'] });
    expect(graph.unresolved.filter((row) => row.reason === 'api-base-unknown')).toEqual([
      {
        file: 'src/api.ts',
        line: 2,
        reason: 'api-base-unknown',
        hint: 'Add VITE_API_URL to services[].apiBaseEnv, and services[].apiTarget to say which service answers it.',
        symbol: 'fetch(`${base}/api/orders`)',
      },
    ]);
  });

  it('says nothing when the key is declared', () => {
    expect(reasons(read(API, { apiBaseEnv: ['VITE_API_URL'] }))).not.toContain('api-base-unknown');
  });

  it('says nothing when the service declares no keys at all', () => {
    expect(reasons(read(API, {}))).not.toContain('api-base-unknown');
  });
});
