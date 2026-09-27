import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type ExtractContext,
  type RepoGraph,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractAngular } from './extract-repo.js';

const CORE = `
export interface ComponentMetadata { selector?: string; template?: string; templateUrl?: string; standalone?: boolean }
export declare function Component(metadata: ComponentMetadata): ClassDecorator;
export interface NgModuleMetadata { declarations?: unknown[]; imports?: unknown[]; providers?: unknown[] }
export declare function NgModule(metadata: NgModuleMetadata): ClassDecorator;
export declare function Injectable(metadata?: { providedIn?: string }): ClassDecorator;
`;

const ROUTER = `
export interface Route {
  path?: string;
  pathMatch?: string;
  component?: unknown;
  loadComponent?: () => unknown;
  loadChildren?: () => unknown;
  children?: Route[];
  redirectTo?: string;
  providers?: unknown[];
  canActivate?: unknown[];
  data?: unknown;
}
export type Routes = Route[];
export declare const RouterModule: { forRoot(routes: Routes): unknown; forChild(routes: Routes): unknown };
export declare function provideRouter(routes: Routes): unknown;
`;

/** One in-memory repository, read the way the command reads a real one. */
const extract = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
  project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
  project.createSourceFile('node_modules/@angular/router/index.d.ts', ROUTER);
  project.createSourceFile('node_modules/@angular/router/package.json', '{"name":"@angular/router"}');
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

/** The label of every screen a link in a template was joined to. */
const opened = (graph: RepoGraph): string[] => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.type === 'triggers')
    .map((edge) => {
      const link = byId.get(edge.from);
      const screen = byId.get(edge.to);
      return `${String(link?.meta?.['route'])} -> ${String(screen?.label)}`;
    })
    .sort();
};

const reasons = (graph: RepoGraph): string[] => graph.unresolved.map((row) => row.reason).sort();

const rows = (graph: RepoGraph, reason: string) =>
  graph.unresolved.filter((row) => row.reason === reason);

/** A screen with nothing in it, for a route to name. */
const screen = (name: string): string =>
  `import { Component } from '@angular/core';
@Component({ selector: 'x-${name.toLowerCase()}', template: '<i></i>' })
export class ${name} {}
`;

/** The one component whose template holds the links under test. */
const shell = (links: readonly string[]): string =>
  `import { Component } from '@angular/core';
@Component({
  selector: 'app-shell',
  template: \`${links.map((link) => `<a routerLink="${link}">go</a>`).join('')}\`,
})
export class ShellComponent {}
`;

describe('what a link opens', () => {
  it('reads a route array exported as a default, with no type annotation', () => {
    const graph = extract({
      'plugins.component.ts': screen('PluginsComponent'),
      'admin.routes.ts': `import { PluginsComponent } from './plugins.component';
export default [{ path: 'plugins', component: PluginsComponent }];
`,
      'shell.component.ts': shell(['/plugins']),
    });
    expect(opened(graph)).toEqual(['/plugins -> PluginsComponent']);
  });

  it('follows a loadChildren to the array the module default-exports, under its prefix', () => {
    const graph = extract({
      'plugins.component.ts': screen('PluginsComponent'),
      'admin.routes.ts': `import { PluginsComponent } from './plugins.component';
export default [{ path: 'plugins', component: PluginsComponent }];
`,
      'main.ts': `import { provideRouter } from '@angular/router';
const routes = [{ path: 'admin', loadChildren: () => import('./admin.routes') }];
provideRouter(routes);
`,
      'shell.component.ts': shell(['/admin/plugins']),
    });
    expect(opened(graph)).toEqual(['/admin/plugins -> PluginsComponent']);
    // And never at the root it would have had if nothing mounted it.
    expect(reasons(graph)).not.toContain('route-target-unresolved');
  });

  it('reads the path a route was spread from', () => {
    const graph = extract({
      'admin.component.ts': screen('AdminComponent'),
      'main.ts': `import { provideRouter } from '@angular/router';
import { AdminComponent } from './admin.component';
const common = { path: 'admin', providers: [] };
provideRouter([{ ...common, component: AdminComponent }]);
`,
      'shell.component.ts': shell(['/admin']),
    });
    expect(opened(graph)).toEqual(['/admin -> AdminComponent']);
  });

  it('splices in an array spread into a list of children', () => {
    const graph = extract({
      'list.component.ts': screen('ListComponent'),
      'plugins.routes.ts': `import { Routes } from '@angular/router';
import { ListComponent } from './list.component';
export const pluginsRoutes: Routes = [{ path: 'plugins', component: ListComponent }];
`,
      'main.ts': `import { provideRouter } from '@angular/router';
import { pluginsRoutes } from './plugins.routes';
provideRouter([{ path: 'settings', children: [...pluginsRoutes] }]);
`,
      'shell.component.ts': shell(['/settings/plugins']),
    });
    expect(opened(graph)).toEqual(['/settings/plugins -> ListComponent']);
  });

  it('gives a forChild array the prefix of the loader that mounts its module', () => {
    const graph = extract({
      'reports.component.ts': screen('ReportsComponent'),
      'reports.module.ts': `import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ReportsComponent } from './reports.component';
const routes: Routes = [{ path: 'weekly', component: ReportsComponent }];
@NgModule({ imports: [RouterModule.forChild(routes)] })
export class ReportsModule {}
`,
      'main.ts': `import { provideRouter } from '@angular/router';
provideRouter([
  { path: 'reports', loadChildren: () => import('./reports.module').then((m) => m.ReportsModule) },
]);
`,
      'shell.component.ts': shell(['/reports/weekly']),
    });
    expect(opened(graph)).toEqual(['/reports/weekly -> ReportsComponent']);
  });

  it('reports a configuration it genuinely could not read, rather than dropping it', () => {
    const graph = extract({
      'main.ts': `import { provideRouter } from '@angular/router';
const which = (name: string): string => \`./\${name}.routes\`;
provideRouter([{ path: 'admin', loadChildren: () => import(which('admin')) }]);
`,
      'shell.component.ts': shell(['/admin/plugins']),
    });
    expect(rows(graph, 'route-config-unread')).toHaveLength(1);
    expect(rows(graph, 'route-config-unread')[0]?.symbol).toBe('/admin');
    // The link is still reported: the route exists, what it mounts does not.
    expect(reasons(graph)).toContain('route-target-unresolved');
  });

  it('leaves an array that is not a route table alone', () => {
    const graph = extract({
      'admin.component.ts': screen('AdminComponent'),
      'menu.ts': `export default [{ path: '/admin', label: 'Admin', icon: 'gear' }];`,
      'main.ts': `import { provideRouter } from '@angular/router';
import { AdminComponent } from './admin.component';
provideRouter([{ path: 'admin', component: AdminComponent }]);
`,
      'shell.component.ts': shell(['/admin']),
    });
    expect(opened(graph)).toEqual(['/admin -> AdminComponent']);
    expect(reasons(graph)).not.toContain('route-path-dynamic');
  });
});

describe('what a binding in a template reaches', () => {
  it('does not report a name the template bound as a method the component lacks', () => {
    const graph = extract({
      'modal.component.ts': `import { Component } from '@angular/core';
@Component({
  selector: 'app-modal',
  template: \`
    <ng-template #modal let-hide="close">
      <button (click)="hide()">Close</button>
    </ng-template>
    <button (click)="modal.open()">Open</button>
    @for (order of orders; track order.id) { <b (click)="order.pick()">pick</b> }
    @let total = 1;
    <i (click)="total.toFixed()">total</i>
  \`,
})
export class ModalComponent {
  orders: { id: string }[] = [];
}
`,
    });
    expect(rows(graph, 'handler-not-found')).toEqual([]);
    // Four bindings, one row: a `nothing` row is folded to one per reason, and
    // `sites` is where the four went.
    const [folded] = rows(graph, 'handler-not-a-method');
    expect(folded?.sites).toBe(4);
    expect(folded?.hint).toContain('hide is bound by the template itself');
  });

  it('still reports a binding that names a method the component does not declare', () => {
    const graph = extract({
      'gone.component.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-gone', template: '<button (click)="save()">save</button>' })
export class GoneComponent {}
`,
    });
    expect(rows(graph, 'handler-not-found')).toHaveLength(1);
    expect(rows(graph, 'handler-not-found')[0]?.hint).toContain('No method named save');
  });
});
