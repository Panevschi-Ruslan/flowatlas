import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractAngular } from './extract-repo.js';

const CORE = `
export interface ComponentMetadata { selector?: string; template?: string }
export declare function Component(metadata: ComponentMetadata): ClassDecorator;
export declare function Directive(metadata: { selector?: string }): ClassDecorator;
export declare function Injectable(metadata?: { providedIn?: string }): ClassDecorator;
`;

const extract = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
  project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  const builder = new GraphBuilder({ repo: 'web', generatedAt: '2026-01-01T00:00:00.000Z' });
  const base: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '.', type: 'angular' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractAngular(base);
  return builder.build();
};

const calls = (graph: RepoGraph): string[] =>
  graph.edges
    .filter((edge) => edge.type === 'calls')
    .map((edge) => `${edge.from.split(':').pop()} -> ${edge.to.split(':').pop()}${edge.meta?.['via'] === 'table' ? ` (table${edge.meta?.['selectedBy'] === undefined ? '' : `, ${edge.meta['selectedBy']}`})` : ''}`)
    .sort();

describe('calls through a table in an Angular class (P399: every form)', () => {
  it('follows a method, a function and an arrow calling a service, picked by find and taken apart', () => {
    const graph = extract({
      'orders.service.ts': `import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class OrdersService {
  load(): void {}
  export(): void {}
}
`,
      'helpers.ts': `import type { OrdersService } from './orders.service';
export function exportAll(orders: OrdersService): void { orders.export(); }
`,
      'toolbar.component.ts': `import { Component } from '@angular/core';
import { exportAll } from './helpers';
import { OrdersService } from './orders.service';
@Component({ selector: 'app-toolbar', template: '' })
export class ToolbarComponent {
  private readonly actions = [
    { key: 'reload', run: () => this.orders.load() },
    { key: 'export', run: (orders: OrdersService) => exportAll(orders) },
    { key: 'clear', run: this.clear.bind(this) },
  ];
  constructor(private readonly orders: OrdersService) {}
  onAction(key: string): void {
    const { run } = this.actions.find((each) => each.key === key)!;
    run(this.orders);
  }
  clear(): void {}
}
`,
    });
    expect(calls(graph)).toEqual([
      'ToolbarComponent.onAction -> OrdersService.export (table, equals export)',
      'ToolbarComponent.onAction -> OrdersService.load (table, equals reload)',
      'ToolbarComponent.onAction -> ToolbarComponent.clear (table, equals clear)',
    ]);
  });

  it('runs every lifecycle hook of a component and a directive as the framework does', () => {
    const graph = extract({
      'focus.directive.ts': `import { Directive } from '@angular/core';
@Directive({ selector: '[appFocus]' })
export class FocusDirective {
  ngAfterContentInit(): void { this.focus(); }
  focus(): void {}
}
`,
      'panel.component.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-panel', template: '' })
export class PanelComponent {
  ngOnChanges(): void { this.refresh(); }
  refresh(): void {}
}
`,
    });
    const hooks = graph.nodes.filter((node) => node.type === 'ui_action' && node.kind === 'lifecycle').map((node) => node.label).sort();
    expect(hooks).toEqual(['ngAfterContentInit', 'ngOnChanges']);
  });
});
