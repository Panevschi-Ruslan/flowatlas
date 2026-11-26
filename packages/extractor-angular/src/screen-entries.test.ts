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
export declare function Injectable(metadata?: { providedIn?: string }): ClassDecorator;
export type Signal<T> = () => T;
export declare function signal<T>(value: T): Signal<T>;
export declare function computed<T>(read: () => T): Signal<T>;
`;

const ROUTER = `
export interface Route { path?: string; component?: unknown; loadComponent?: () => unknown; loadChildren?: () => unknown; children?: Route[]; redirectTo?: string; canActivate?: unknown[] }
export type Routes = Route[];
export declare function provideRouter(routes: Routes): unknown;
export declare class Router { navigate(commands: unknown[]): Promise<boolean>; navigateByUrl(url: string): Promise<boolean> }
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

const screen = (name: string): string =>
  `import { Component } from '@angular/core';
@Component({ selector: 'x-${name.toLowerCase()}', template: '<i></i>' })
export class ${name} {}
`;

/** Every screen's address and what it shows, `/path -> Component`. */
const screens = (graph: RepoGraph): string[] => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.type === 'handles' && byId.get(edge.from)?.kind === 'screen')
    .map((edge) => `${String(byId.get(edge.from)?.label)} -> ${String(byId.get(edge.to)?.label)}`)
    .sort();
};

/** Every screen a click or a link lands on, `address -> Component`. */
const landed = (graph: RepoGraph): string[] => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.type === 'triggers' && byId.get(edge.to)?.type === 'ui_component')
    .map((edge) => `${String(edge.meta?.['navigates'] ?? edge.meta?.['route'] ?? byId.get(edge.from)?.meta?.['route'])} -> ${String(byId.get(edge.to)?.label)}`)
    .sort();
};

const rows = (graph: RepoGraph, reason: string) => graph.unresolved.filter((row) => row.reason === reason);

const ROUTES = `import { provideRouter } from '@angular/router';
import { ShellComponent } from './shell.component';
import { MapComponent } from './map.component';
import { ArchiveComponent } from './archive.component';
const guard = () => true;
provideRouter([
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: 'map', component: MapComponent, canActivate: [guard] },
      { path: 'archive', loadComponent: () => import('./archive.component').then((m) => m.ArchiveComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
]);
`;

describe('a screen the router registers is a way in (P363)', () => {
  it('makes each routed component the code behind an entry at its full address', () => {
    const graph = extract({
      'main.ts': ROUTES,
      'shell.component.ts': screen('ShellComponent'),
      'map.component.ts': screen('MapComponent'),
      'archive.component.ts': screen('ArchiveComponent'),
    });
    expect(screens(graph)).toEqual(['/ -> ShellComponent', '/archive -> ArchiveComponent', '/map -> MapComponent']);
    const map = graph.nodes.find((node) => node.id === 'entry:web:screen:/map');
    expect(map).toMatchObject({ type: 'entry', kind: 'screen', file: 'main.ts', meta: { path: '/map', guards: ['canActivate guard'], screens: ['MapComponent'] } });
    // The component keeps its address, as a page of the other front ends does.
    expect(graph.nodes.find((node) => node.label === 'ArchiveComponent')?.meta?.['route']).toBe('/archive');
  });

  it('draws no screen for a route that only redirects, and none at all without a configuration', () => {
    const graph = extract({ 'map.component.ts': screen('MapComponent') });
    expect(screens(graph)).toEqual([]);
    expect(graph.nodes.filter((node) => node.type === 'entry')).toEqual([]);
  });
});

const CATALOG = `export interface NavItem { label: string; route: string; section: string; hidden?: boolean }
export const NAV: NavItem[] = [
  { label: 'Map', route: '/map', section: 'Main' },
  { label: 'Archive', route: '/archive', section: 'Main' },
  { label: 'Ghost', route: '/ghost', section: 'Other' },
];
export const SECTIONS = [{ name: 'Main' }, { name: 'Other' }];
`;

const sidebar = (members: string, template: string): string => `import { Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NAV, SECTIONS } from './nav';
@Component({ selector: 'app-sidebar', template: \`${template}\` })
export class SidebarComponent {
  constructor(public router: Router) {}
  ${members}
}
`;

const withSidebar = (members: string, template: string): RepoGraph =>
  extract({
    'main.ts': ROUTES,
    'shell.component.ts': screen('ShellComponent'),
    'map.component.ts': screen('MapComponent'),
    'archive.component.ts': screen('ArchiveComponent'),
    'nav.ts': CATALOG,
    'sidebar.component.ts': sidebar(members, template),
  });

describe('a link rendered over a constant list (P363)', () => {
  it('reads [routerLink] over a computed signal that filters an imported constant', () => {
    const graph = withSidebar(
      'readonly show = signal(false);\n  readonly items = computed(() => NAV.filter((item) => this.show() || !item.hidden));',
      '@for (item of items(); track item.route) { <a [routerLink]="item.route">x</a> }',
    );
    expect(landed(graph)).toEqual(['/archive -> ArchiveComponent', '/map -> MapComponent']);
    const ghost = rows(graph, 'route-target-unresolved');
    expect(ghost.map((row) => row.symbol)).toEqual(['SidebarComponent item.route -> /ghost']);
    expect(ghost[0]?.hint).toContain('NAV');
    const link = graph.nodes.find((node) => node.type === 'ui_action' && node.kind === 'route');
    expect(link?.meta?.['routes']).toEqual(['/archive', '/ghost', '/map']);
  });

  it('reads a getter mapping the list to objects, a method answering it, and a field holding it', () => {
    for (const [members, list] of [
      ['get links() { return NAV.map((item) => ({ ...item, active: false })); }', 'links'],
      ['entries() { return NAV.slice(0, 2); }', 'entries()'],
      ['readonly all = NAV;', 'all'],
      ['readonly paths = NAV.map((item) => ({ route: item.route }));', 'paths'],
    ] as const) {
      const graph = withSidebar(members, `@for (each of ${list}; track each) { <a [routerLink]="each.route">x</a> }`);
      expect(landed(graph), list).toContain('/map -> MapComponent');
      expect(landed(graph), list).toContain('/archive -> ArchiveComponent');
    }
  });

  it('reads a nested *ngFor through an element member, and routerLink written with {{ }}', () => {
    const graph = withSidebar(
      'readonly sections = computed(() => SECTIONS.map((section) => ({ ...section, links: NAV.filter((item) => item.section === section.name) })));',
      '<div *ngFor="let section of sections()"><a *ngFor="let link of section.links" routerLink="{{ link.route }}">x</a></div>',
    );
    expect(landed(graph)).toEqual(['/archive -> ArchiveComponent', '/map -> MapComponent']);
    expect(rows(graph, 'route-target-unresolved').map((row) => row.symbol)).toEqual(['SidebarComponent {{ link.route }} -> /ghost']);
  });

  it('lands a click that navigates to an entry of the list', () => {
    const graph = withSidebar(
      'readonly items = NAV;',
      '@for (item of items; track item.route) { <button (click)="router.navigate([item.route])">x</button><button (click)="router.navigateByUrl(item.route)">y</button> }',
    );
    expect(landed(graph).filter((each) => each.endsWith('MapComponent'))).toEqual(['/map -> MapComponent', '/map -> MapComponent']);
    // Both buttons are on one line, which is one place to correct.
    expect(rows(graph, 'navigation-unresolved').map((row) => row.symbol)).toEqual(['SidebarComponent (click) navigates to /ghost']);
  });

  it('says why a list arriving at run time is not read, and keeps a segment read at run time a parameter', () => {
    const graph = withSidebar(
      'readonly remote$: unknown;\n  readonly orders = signal<Array<{ id: string }>>([]);',
      '@for (item of remote$ | async; track item) { <a [routerLink]="item.route">x</a> } @for (order of orders(); track order.id) { <a [routerLink]="[\'/map\', order.id]">o</a> }',
    );
    const dynamic = rows(graph, 'route-link-dynamic');
    expect(dynamic.map((row) => row.symbol)).toEqual(['SidebarComponent item.route']);
    expect(dynamic[0]?.hint).toContain('remote$ | async');
    // `/map/:param` is no configured route, as before: nothing in the list was read, so the link is judged as written.
    expect(rows(graph, 'route-target-unresolved').map((row) => row.symbol)).toEqual(["SidebarComponent ['/map', order.id]"]);
  });
});
