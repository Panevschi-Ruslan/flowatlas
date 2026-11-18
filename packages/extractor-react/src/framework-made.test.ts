import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractReact } from './extract-repo.js';

/** Reads a repository written in memory, with nothing installed. */
const read = (files: Record<string, string>, dependencies: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, strict: false, jsx: 4, experimentalDecorators: true } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'react' },
    config: parseConfig({}),
    pkg: { dependencies },
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractReact(ctx, { noTypes: true });
  return builder.build();
};

/** Each request as `<caller> <host> <path>`, sorted. */
const placed = (graph: RepoGraph): string[] => {
  const label = (id: string): string | undefined => graph.nodes.find((node) => node.id === id)?.label;
  return graph.nodes
    .filter((node) => node.type === 'ui_api_call')
    .map((node) => [label(graph.edges.find((edge) => edge.to === node.id && edge.type === 'calls')?.from ?? ''), node.meta?.['host'] ?? '', node.meta?.['path']].join(' '))
    .sort();
};

const CLIENTS = ["import axios from 'axios';", "const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });", "const stockApi = axios.create({ baseURL: 'http://localhost:4700' });"];

describe('instances a framework makes (P342)', () => {
  it('reads an element written with a component as its tag as its instance, its attributes the props', () => {
    const graph = read(
      {
        '/src/pages.jsx': [
          ...CLIENTS,
          "import { Component, useEffect } from 'react';",
          // A destructured prop, a prop read off the props, and a class component's `this.props`.
          "function Feed({ client }) { useEffect(() => { client.get('/feed'); }, []); return null; }",
          "const Panel = (props) => { useEffect(() => { props.client.get('/panel'); }, []); return null; };",
          "class Lister extends Component { componentDidMount() { return this.props.client.get('/list'); } render() { return null; } }",
          // A prop a spread hands is a value not read, passed over as an untyped one is (P301): the instance read is the request's.
          "function Spread({ client }) { useEffect(() => { client.get('/spread'); }, []); return null; }",
          'export function CatalogPage(rest) { return <div><Feed client={catalogApi} /><Panel client={catalogApi} /><Lister client={catalogApi} /><Spread client={catalogApi} /></div>; }',
          'export function StockPage(rest) { return <div><Feed client={stockApi} /><Panel client={stockApi} /><Lister client={stockApi} /><Spread {...rest} /></div>; }',
        ].join('\n'),
      },
      { react: '^19.0.0', axios: '^1.0.0' },
    );
    expect(placed(graph)).toEqual([
      'CatalogPage localhost:4600 /feed',
      'CatalogPage localhost:4600 /list',
      'CatalogPage localhost:4600 /panel',
      'Spread localhost:4600 /spread',
      'StockPage localhost:4700 /feed',
      'StockPage localhost:4700 /list',
      'StockPage localhost:4700 /panel',
    ]);
  });

  it('reads a provider a module lists as the instance the injector makes, its constructor handed what the module provides', () => {
    const graph = read(
      {
        '/src/jobs.ts': [
          ...CLIENTS,
          "import { Inject, Injectable, Module } from '@nestjs/common';",
          "import { Interval } from '@nestjs/schedule';",
          // Listed by class, its client injected by token: the listed instance is the one the framework calls.
          '@Injectable()',
          'export class Poller {',
          "  constructor(@Inject('API') private api) {}",
          "  @Interval(1000) poll() { return this.api.get('/health'); }",
          '}',
          'export function probe() { return new Poller(stockApi); }',
          // Provided by another class's name, which hands its token's value on to `super`.
          'export class Reader {',
          '  constructor(private api) {}',
          '  read(path) { return this.api.get(path); }',
          '}',
          '@Injectable()',
          "export class StockReader extends Reader { constructor(@Inject('STOCK') api) { super(api); } }",
          '@Injectable()',
          "export class Levels { constructor(private reader: Reader) {} onModuleInit() { return this.reader.read('/levels'); } }",
          "export function catalogLevels() { return new Reader(catalogApi).read('/levels'); }",
          '@Module({',
          "  providers: [Poller, Levels, { provide: 'API', useValue: catalogApi }, { provide: 'STOCK', useFactory: () => stockApi }, { provide: Reader, useClass: StockReader }],",
          '})',
          'export class JobsModule {}',
        ].join('\n'),
      },
      { axios: '^1.0.0', '@nestjs/common': '^10.0.0', '@nestjs/schedule': '^4.0.0' },
    );
    expect(placed(graph)).toEqual(['Levels.onModuleInit localhost:4700 /levels', 'Poller.poll localhost:4600 /health', 'catalogLevels localhost:4600 /levels']);
    expect(graph.unresolved.filter((row) => row.reason === 'api-client-base-unread')).toEqual([]);
  });
});

describe('components wrapped in calls, props handed through a spread, providers built and handed on (P349)', () => {
  it('reads a component wrapped in memo, forwardRef or both, exported or not, as a component whose props each element hands', () => {
    const graph = read(
      {
        '/src/pages.jsx': [
          ...CLIENTS,
          "import React, { memo, forwardRef, useEffect } from 'react';",
          "const Feed = memo(function Feed({ client }) { useEffect(() => { client.get('/feed'); }, []); return <i />; });",
          "const Panel = React.memo((props) => { useEffect(() => { props.client.get('/panel'); }, []); return <i />; });",
          "const Field = forwardRef((props, ref) => { useEffect(() => { props.client.get('/field'); }, []); return <i ref={ref} />; });",
          "export const Both = memo(forwardRef(({ client }, ref) => { useEffect(() => { client.get('/both'); }, []); return <i ref={ref} />; }));",
          // Kept under a capitalised name, but no markup: no component.
          "const Loader = memo(() => catalogApi.get('/loader'));",
          'export function CatalogPage() { return <div><Feed client={catalogApi} /><Panel client={catalogApi} /><Field client={catalogApi} /><Both client={catalogApi} /></div>; }',
          'export function StockPage() { return <div><Feed client={stockApi} /><Panel client={stockApi} /><Field client={stockApi} /><Both client={stockApi} /></div>; }',
        ].join('\n'),
      },
      { react: '^19.0.0', axios: '^1.0.0' },
    );
    expect(placed(graph)).toEqual([
      'CatalogPage localhost:4600 /both',
      'CatalogPage localhost:4600 /feed',
      'CatalogPage localhost:4600 /field',
      'CatalogPage localhost:4600 /panel',
      'StockPage localhost:4700 /both',
      'StockPage localhost:4700 /feed',
      'StockPage localhost:4700 /field',
      'StockPage localhost:4700 /panel',
    ]);
    const components = graph.nodes.filter((node) => node.type === 'ui_component').map((node) => node.label).sort();
    expect(components).toEqual(['Both', 'CatalogPage', 'Feed', 'Field', 'Panel', 'StockPage']);
  });

  it('follows a prop handed through a spread of the props an element hands, of a rest, or of an object, and says one it cannot follow', () => {
    const graph = read(
      {
        '/src/pages.jsx': [
          ...CLIENTS,
          "import { useEffect } from 'react';",
          "function Feed({ client }) { useEffect(() => { client.get('/feed'); }, []); return <i />; }",
          // A rest of the props, the props whole with a prop written after it, an object written in place.
          'function Shell({ title, ...rest }) { return <section><h1>{title}</h1><Feed {...rest} /></section>; }',
          'function Over(props) { return <Feed {...props} client={stockApi} />; }',
          'function Literal() { return <Feed {...{ client: catalogApi }} />; }',
          // The props of a component nothing renders: not read, and said.
          'function Lost(props) { return <Feed {...props} />; }',
          'export function CatalogPage() { return <div><Shell title="a" client={catalogApi} /><Literal /></div>; }',
          'export function StockPage() { return <div><Shell title="b" client={stockApi} /><Over client={catalogApi} /></div>; }',
        ].join('\n'),
      },
      { react: '^19.0.0', axios: '^1.0.0' },
    );
    expect(placed(graph)).toEqual(['CatalogPage localhost:4600 /feed', 'Literal localhost:4600 /feed', 'Over localhost:4700 /feed', 'StockPage localhost:4700 /feed']);
    const rows = graph.unresolved.filter((row) => row.reason === 'api-client-base-unread');
    expect(rows.map((row) => [row.file, row.line, row.meta?.['spread']])).toEqual([['src/pages.jsx', 5, { file: 'src/pages.jsx', line: 9 }]]);
    expect(rows[0]?.hint).toContain('{...props}');
  });

  it('reads providers spread in from a list, returned by a function, named by useExisting or made with new', () => {
    const graph = read(
      {
        '/src/shared.ts': [
          CLIENTS[0] as string,
          ...CLIENTS.slice(1).map((line) => `export ${line}`),
          'export class Reader { constructor(private api) {} read(path) { return this.api.get(path); } }',
          "export const SHARED = [{ provide: 'CATALOG', useValue: catalogApi }];",
          "export function more() { return [{ provide: 'STOCK', useValue: stockApi }, { provide: 'ALIAS', useExisting: 'STOCK' }]; }",
          "export const made = { provide: 'MADE', useValue: new Reader(catalogApi) };",
        ].join('\n'),
        '/src/jobs.ts': [
          "import { Inject, Injectable, Module } from '@nestjs/common';",
          "import { SHARED, more, made } from './shared';",
          '@Injectable()',
          "export class Catalog { constructor(@Inject('CATALOG') private api) {} onModuleInit() { return this.api.get('/catalog'); } }",
          '@Injectable()',
          "export class Stock { constructor(@Inject('ALIAS') private api) {} onModuleInit() { return this.api.get('/stock'); } }",
          '@Injectable()',
          "export class Made { constructor(@Inject('MADE') private reader) {} onModuleInit() { return this.reader.read('/made'); } }",
          '@Module({ providers: [...SHARED, ...more(), made, Catalog, Stock, Made] })',
          'export class JobsModule {}',
        ].join('\n'),
      },
      { axios: '^1.0.0', '@nestjs/common': '^10.0.0' },
    );
    expect(placed(graph)).toEqual(['Catalog.onModuleInit localhost:4600 /catalog', 'Made.onModuleInit localhost:4600 /made', 'Stock.onModuleInit localhost:4700 /stock']);
  });
});

describe('components a wrapper takes after its options, and a rest of props (P353)', () => {
  it("reads a component written in place after a wrapper's options, and a rest as the props less the members named beside it", () => {
    const graph = read(
      {
        '/src/pages.jsx': [
          ...CLIENTS,
          "import { memo, useEffect } from 'react';",
          'function withOptions(options, Component) { return Component; }',
          "const Board = withOptions({ name: 'board' }, function Board({ client }) { useEffect(() => { client.get('/board'); }, []); return <i />; });",
          "const Chart = withOptions({ name: 'chart' }, memo((props) => { useEffect(() => { props.client.get('/chart'); }, []); return <i />; }));",
          "function Badge({ client }) { useEffect(() => { if (client) client.get('/badge'); }, []); return <i />; }",
          // `rest` lacks `client`, named beside it: `Badge` is handed none by this element.
          'function Frame({ client, title, ...rest }) { return <section><h1>{title}</h1><Badge {...rest} /></section>; }',
          'export function CatalogPage() { return <div><Board client={catalogApi} /><Chart client={catalogApi} /><Frame title="a" client={catalogApi} /></div>; }',
          'export function StockPage() { return <div><Board client={stockApi} /><Chart client={stockApi} /><Badge client={stockApi} /></div>; }',
        ].join('\n'),
      },
      { react: '^19.0.0', axios: '^1.0.0' },
    );
    expect(placed(graph)).toEqual([
      'Badge localhost:4700 /badge',
      'CatalogPage localhost:4600 /board',
      'CatalogPage localhost:4600 /chart',
      'StockPage localhost:4700 /board',
      'StockPage localhost:4700 /chart',
    ]);
    expect(graph.unresolved.filter((row) => row.reason === 'api-client-base-unread')).toEqual([]);
  });
});
