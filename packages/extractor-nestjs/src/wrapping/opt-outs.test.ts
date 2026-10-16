import { Project, type ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { FlagReaders, flagsOf } from './opt-outs.js';

// What a whole application reads is the snapshot of fixtures/nest-route-access.

const projectOf = (files: Record<string, string>) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  return project;
};

const DECORATORS = `
  import { SetMetadata, applyDecorators, Header } from '@nestjs/common';
  export const IS_PUBLIC_KEY = 'isPublic';
  export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
  export const OpenRoute = () => applyDecorators(Public(), Header('Cache-Control', 'public'));
  export function SkipTenant() { return SetMetadata('skipTenant', true); }
  export const Strict = () => SetMetadata('strictSession', true);
  export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
`;

const classIn = (project: Project, path: string, name: string): ClassDeclaration =>
  project.getSourceFileOrThrow(path).getClassOrThrow(name);

describe('opt-out flags on a handler', () => {
  const project = projectOf({
    '/src/decorators.ts': DECORATORS,
    '/src/orders.controller.ts': `
      import { Public, OpenRoute, SkipTenant, Strict, Roles } from './decorators';
      @Public()
      export class StatusController { size() { return 0; } }
      export class OrdersController {
        @OpenRoute() related() { return 0; }
        @SkipTenant() webhook() { return 0; }
        @Strict() import() { return 0; }
        @Roles('admin') admin() { return 0; }
      }`,
    '/src/jwt.guard.ts': `
      import { IS_PUBLIC_KEY } from './decorators';
      export class JwtGuard {
        constructor(private readonly reflector: { getAllAndOverride(key: unknown, targets: unknown[]): boolean }) {}
        canActivate(): boolean { return this.reflector.getAllAndOverride(IS_PUBLIC_KEY, []) || false; }
      }`,
    '/src/tenant.guard.ts': `
      export class TenantGuard { canActivate(reflector: { get(key: string): boolean }): boolean { return reflector.get('skipTenant'); } }`,
  });
  const fileOf = (node: { getSourceFile(): { getFilePath(): string } }) => node.getSourceFile().getFilePath().slice(1);
  const orders = classIn(project, '/src/orders.controller.ts', 'OrdersController');
  const method = (name: string) => orders.getMethodOrThrow(name);

  it('reads SetMetadata(key, true) through a function of the project and applyDecorators', () => {
    expect(flagsOf(method('related'), 'route', fileOf)).toMatchObject([
      { decorator: 'OpenRoute', key: 'isPublic', keyValue: 'isPublic', where: 'route', file: 'src/orders.controller.ts' },
    ]);
    expect(flagsOf(method('webhook'), 'route', fileOf)).toMatchObject([{ decorator: 'SkipTenant', key: 'skipTenant' }]);
    expect(flagsOf(classIn(project, '/src/orders.controller.ts', 'StatusController'), 'controller', fileOf)).toMatchObject([
      { decorator: 'Public', key: 'isPublic', where: 'controller' },
    ]);
  });

  it('takes neither a flag that holds a request to more nor metadata that is not true', () => {
    expect(flagsOf(method('import'), 'route', fileOf)).toEqual([]);
    expect(flagsOf(method('admin'), 'route', fileOf)).toEqual([]);
  });

  it('says which check reads a flag, by the key it names or the string it spells', () => {
    const readers = new FlagReaders();
    const jwt = classIn(project, '/src/jwt.guard.ts', 'JwtGuard');
    const tenant = classIn(project, '/src/tenant.guard.ts', 'TenantGuard');
    const [open] = flagsOf(method('related'), 'route', fileOf);
    const [skip] = flagsOf(method('webhook'), 'route', fileOf);
    expect(readers.reads(jwt, open!)).toBe(true);
    expect(readers.reads(tenant, open!)).toBe(false);
    expect(readers.reads(tenant, skip!)).toBe(true);
    expect(readers.reads(jwt, skip!)).toBe(false);
  });
});
