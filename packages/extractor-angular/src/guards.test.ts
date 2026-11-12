import { GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractAngular } from './extract-repo.js';

const CORE = `
export interface ComponentMetadata { selector?: string; template?: string }
export declare function Component(metadata: ComponentMetadata): ClassDecorator;
export declare function Injectable(metadata?: { providedIn?: string }): ClassDecorator;
export declare function inject<T>(token: new (...args: never[]) => T): T;
`;

const ROUTER = `
export interface Route {
  path?: string;
  component?: unknown;
  children?: Route[];
  canActivate?: unknown[];
  canActivateChild?: unknown[];
  canMatch?: unknown[];
  resolve?: Record<string, unknown>;
}
export type Routes = Route[];
export declare class Router { navigate(commands: unknown[]): Promise<boolean>; navigateByUrl(url: string): Promise<boolean> }
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

const files = {
  'app.routes.ts': `import { inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AdminGuard } from './admin.guard';
import { requireSession, roleGuard, totalsResolver } from './guards';
import { SessionService } from './session.service';
import { StartComponent } from './start.component';
import { SignInComponent } from './sign-in.component';
import { ReportsComponent } from './reports.component';
import { UsersComponent } from './users.component';
export const config = provideRouter([
  { path: '', component: StartComponent },
  { path: 'sign-in', component: SignInComponent, canActivate: [() => !inject(SessionService).isSignedIn()] },
  { path: 'reports', component: ReportsComponent, canActivate: [requireSession], resolve: { totals: totalsResolver } },
  {
    path: 'admin',
    canActivate: [requireSession],
    canActivateChild: [AdminGuard],
    children: [{ path: 'users', component: UsersComponent, canActivate: [roleGuard('owner'), 42] }],
  },
]);
`,
  'session.service.ts': `import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class SessionService {
  isSignedIn(): boolean { return true; }
  hasRole(role: string): boolean { return role !== ''; }
}
`,
  'reports.service.ts': `import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class ReportsService {
  totals(): number { return 0; }
}
`,
  'admin.guard.ts': `import { Injectable } from '@angular/core';
import { SessionService } from './session.service';
@Injectable({ providedIn: 'root' })
export class AdminGuard {
  constructor(private readonly session: SessionService) {}
  canActivateChild(): boolean { return this.session.hasRole('admin'); }
}
`,
  'guards.ts': `import { inject } from '@angular/core';
import { ReportsService } from './reports.service';
import { SessionService } from './session.service';
export const requireSession = () => {
  const session = inject(SessionService);
  return session.isSignedIn();
};
export const roleGuard = (role: string) => () => inject(SessionService).hasRole(role);
export const totalsResolver = () => inject(ReportsService).totals();
`,
  'start.component.ts': `import { Component } from '@angular/core';
import { Router } from '@angular/router';
@Component({ selector: 'app-start', template: '<p></p>' })
export class StartComponent {
  constructor(private readonly router: Router) {}
  openWeek(): void {
    this.router.navigateByUrl('/reports?range=week');
    this.router.navigate(['/reports']);
  }
}
`,
  'sign-in.component.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-sign-in', template: '<form></form>' })
export class SignInComponent {}
`,
  'reports.component.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-reports', template: '<p></p>' })
export class ReportsComponent {}
`,
  'users.component.ts': `import { Component } from '@angular/core';
@Component({ selector: 'app-users', template: '<ul></ul>' })
export class UsersComponent {}
`,
};

describe("a route's guards and resolvers in front of its screen, and one edge per screen (P291)", () => {
  const graph = extract(files);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const label = (id: string): string => {
    const node = byId.get(id);
    return node?.type === 'method' ? String(node.id.split(':').at(-1)) : String(node?.label);
  };

  it('draws every guard and resolver the router runs before a screen, in order, whether it navigates or not', () => {
    const guards = graph.edges
      .filter((edge) => edge.meta?.['guard'] !== undefined)
      .map((edge) => `${label(edge.from)} ${String(edge.meta?.['order'])} ${String(edge.meta?.['guard'])} ${label(edge.to)}${edge.meta?.['factory'] === true ? ' (factory)' : ''}`)
      .sort();
    expect(guards).toEqual([
      'ReportsComponent 0 canActivate requireSession',
      'ReportsComponent 1 resolve totalsResolver',
      'SignInComponent 0 canActivate canActivate@12',
      // The parent's canActivate, then its canActivateChild, then the route's own.
      'UsersComponent 0 canActivate requireSession',
      'UsersComponent 1 canActivateChild AdminGuard.canActivateChild',
      'UsersComponent 2 canActivate roleGuard (factory)',
    ]);
  });

  it("goes on past a functional guard to what it asks a service it injects, and says what it could not read", () => {
    const injected = graph.edges
      .filter((edge) => edge.type === 'calls' && byId.get(edge.from)?.type === 'function' && edge.meta?.['guard'] === undefined)
      .map((edge) => `${label(edge.from)} -> ${label(edge.to)}`)
      .sort();
    expect(injected).toEqual([
      'canActivate@12 -> SessionService.isSignedIn',
      'requireSession -> SessionService.isSignedIn',
      'roleGuard -> SessionService.hasRole',
      'totalsResolver -> ReportsService.totals',
    ]);
    // A guard written as code is a row, never silence.
    expect(graph.unresolved.filter((row) => row.reason === 'route-config-unread').map((row) => row.symbol)).toEqual(['/admin/users canActivate']);
  });

  it('keeps every address two navigations to one screen write on the one edge', () => {
    const edge = graph.edges.find((each) => each.meta?.['navigates'] !== undefined && each.to.endsWith('ReportsComponent'));
    expect(edge?.meta?.['navigates']).toBe('/reports?range=week');
    expect(edge?.meta?.['alsoNavigates']).toEqual(['/reports']);
  });
});
