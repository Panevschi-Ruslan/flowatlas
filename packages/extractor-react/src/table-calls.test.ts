import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** Reads a repository written in memory, with nothing installed. */
const read = (files: Record<string, string>, type = 'react'): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, jsx: 4, allowJs: true } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type },
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

/** Each call between functions, as `from -> to`, marked where it came through a table. */
const calls = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && !edge.to.startsWith('ui_api_call'))
    .map((edge) => `${edge.from.split(':').pop()} -> ${edge.to.split(':').pop()}${edge.meta?.['via'] === 'table' ? ` (${String(edge.meta?.['selectedBy'] ?? 'table')})` : ''}`)
    .sort();

describe('calls through a table in a screen (P399)', () => {
  it('draws each element a selection picks: a function, an imported one, and an arrow calling one', () => {
    const graph = read({
      '/src/api.ts': `export async function save() { await fetch('/api/save'); }\nexport async function load() { await fetch('/api/load'); }`,
      '/src/Toolbar.tsx': `import { load, save } from './api';
const refresh = () => load();
const ACTIONS = [
  { key: 'refresh', run: refresh },
  { key: 'save', run: save },
  { key: 'both', run: () => { void save(); void load(); } },
] as const;
export const Toolbar = () => {
  const onAction = (key: string) => ACTIONS.find((each) => each.key === key)?.run();
  return <button onClick={() => onAction('save')}>Save</button>;
};`,
    });
    expect(calls(graph)).toEqual(
      expect.arrayContaining(['Toolbar -> load (equals both)', 'Toolbar -> refresh (equals refresh)', 'Toolbar -> save (equals save)', 'refresh -> load']),
    );
  });

  it('counts the elements it could not read', () => {
    const graph = read({
      '/src/Menu.tsx': `declare const more: Array<{ key: string; run: () => void }>;
function open() {}
const ITEMS = [{ key: 'open', run: open }, ...more];
export const Menu = () => {
  const pick = (key: string) => ITEMS.find((each) => each.key === key)?.run();
  return <button onClick={() => pick('open')}>Open</button>;
};`,
    });
    expect(calls(graph)).toContain('Menu -> open (equals open)');
    const rows = graph.unresolved.filter((row) => row.reason === 'call-dynamic-receiver');
    expect(rows.map((row) => row.hint)).toEqual([expect.stringContaining('1 of 2 elements')]);
  });
});
