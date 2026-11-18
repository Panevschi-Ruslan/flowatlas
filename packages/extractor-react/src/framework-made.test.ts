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
