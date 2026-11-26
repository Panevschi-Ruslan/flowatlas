import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** A screen's repository written in memory, read as the build reads one. */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, jsx: 4, allowJs: true, lib: ['lib.dom.d.ts', 'lib.es2022.d.ts'] } });
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

const streams = (graph: RepoGraph): Array<[string | undefined, unknown]> =>
  graph.nodes.filter((node) => node.type === 'ui_api_call' && node.kind === 'sse').map((node) => [node.file, node.meta?.['path']]);

/** Which function each stream's frames arrive at, by the request that triggers it. */
const fed = (graph: RepoGraph): Array<[string, string]> =>
  graph.edges
    .filter((edge) => edge.type === 'triggers' && edge.from.startsWith('ui_api_call:'))
    .map((edge): [string, string] => {
      const handled = graph.edges.find((each) => each.type === 'handles' && each.from === edge.to);
      return [edge.from.replace(/^ui_api_call:web#/, ''), handled?.to.replace(/^web#/, '') ?? '?'];
    })
    .sort((a, b) => (a.join() < b.join() ? -1 : 1));

const reasons = (graph: RepoGraph): string[] => graph.unresolved.map((row) => `${row.file}:${row.line} ${row.reason}`);

describe('streams of server-sent events a screen opens (P359)', () => {
  it('reads the stream as a GET request and the function named for its frames as its consumer', () => {
    const graph = read({
      '/src/ticker.ts': [
        'function onTick(frame: MessageEvent): void { void frame; }',
        'export function start(id: string): void {',
        '  const source = new EventSource(`https://edge.example.test/live/${id}`);',
        "  source.addEventListener('tick', onTick);",
        '}',
      ].join('\n'),
    });
    expect(streams(graph)).toEqual([['src/ticker.ts', '/live/:param']]);
    expect(fed(graph)).toEqual([['src/ticker.ts:3:18', 'src/ticker.ts:onTick']]);
    const consumer = graph.nodes.find((node) => node.id === 'consumer:web#src/ticker.ts:onTick');
    expect(consumer).toMatchObject({ type: 'consumer', kind: 'sse', meta: { events: ['tick'], entryId: null } });
  });

  it('follows a handler handed into a hook to the function each caller hands', () => {
    const graph = read({
      '/src/useLive.ts': [
        "import { useEffect } from 'react';",
        'export function useLive(id: string, onEvent: (e: unknown) => void): void {',
        '  useEffect(() => {',
        '    const source = new EventSource(`https://api.example.test/spaces/${id}/events`);',
        '    source.onmessage = (frame) => onEvent(JSON.parse(frame.data));',
        '    return () => source.close();',
        '  }, [id]);',
        '}',
      ].join('\n'),
      '/src/Board.tsx': [
        "import { useLive } from './useLive';",
        'export function handleEvent(e: unknown): void { void e; }',
        'export function Board({ id }: { id: string }) {',
        '  useLive(id, handleEvent);',
        '  return <ul />;',
        '}',
        'export function Panel({ id }: { id: string }) {',
        '  useLive(id, (e) => { console.log(e); console.log(id); });',
        '  return <p />;',
        '}',
      ].join('\n'),
    });
    expect(streams(graph)).toEqual([['src/useLive.ts', '/spaces/:param/events']]);
    expect(fed(graph)).toEqual([
      ['src/useLive.ts:4:20', 'src/Board.tsx:Panel'],
      ['src/useLive.ts:4:20', 'src/Board.tsx:handleEvent'],
    ].sort((a, b) => (a.join() < b.join() ? -1 : 1)));
  });

  it('reads the listener written in place as its own step, in the function it is written in', () => {
    const graph = read({
      '/src/Screen.tsx': [
        "import { useEffect } from 'react';",
        'export function Screen() {',
        '  useEffect(() => {',
        "    const source = new EventSource('https://api.example.test/feed');",
        "    source.addEventListener('message', (e) => { console.log(e); console.log(1); });",
        '  }, []);',
        '  return <p />;',
        '}',
      ].join('\n'),
    });
    expect(fed(graph)).toEqual([['src/Screen.tsx:4:20', 'src/Screen.tsx:Screen']]);
  });

  it('says so where nothing listens, and where the listener is a value not followed', () => {
    const graph = read({
      '/src/quiet.ts': "export function quiet(): void { void new EventSource('https://api.example.test/feed'); }\n",
      '/src/looked.ts': [
        'declare const handlers: Record<string, (e: MessageEvent) => void>;',
        'export function looked(kind: string): void {',
        "  const source = new EventSource('https://api.example.test/feed');",
        '  source.onmessage = handlers[kind];',
        '}',
      ].join('\n'),
    });
    // Informational rows of one reason are folded into one, which counts its sites.
    const rows = graph.unresolved.filter((row) => row.reason === 'stream-handler-unread');
    expect(rows.reduce((sum, row) => sum + (row.sites ?? 1), 0)).toBe(2);
    expect(rows.map((row) => row.level)).toEqual(['info']);
    expect(fed(graph)).toEqual([]);
  });

  it('reads nothing of a class of the repository named like the client', () => {
    const graph = read({
      '/src/replay.ts': "export class EventSource { constructor(readonly frames: string[]) {} }\nexport function replay() { return new EventSource(['a']); }\n",
    });
    expect(streams(graph)).toEqual([]);
    expect(reasons(graph)).toEqual([]);
  });
});
