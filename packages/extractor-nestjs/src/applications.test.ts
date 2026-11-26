import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  applicationFindings,
  applicationMembership,
  readApplicationRoots,
  routeRegistrationOf,
} from './applications.js';
import { buildClassIndex } from './index-classes.js';
import { ModuleIndex, type ModuleInfo } from './modules-index.js';

const ROOT = '/repo';

const repoOf = (files: Record<string, string>): Project => {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) {
    project.createSourceFile(`${ROOT}/${path}`, text);
  }
  return project;
};

const read = (files: Record<string, string>) =>
  readApplicationRoots({ project: repoOf(files), rootDir: ROOT });

describe('reading which applications a repository creates', () => {
  it('finds the root module a factory call names', () => {
    const { roots } = read({
      'src/app.module.ts': `export class AppModule {}`,
      'src/main.ts': `
        import { AppModule } from './app.module';
        const app = await NestFactory.create(AppModule);
      `,
    });
    expect(roots.map((root) => root.name)).toEqual(['AppModule']);
    expect(roots[0]?.file).toBe('src/main.ts');
  });

  it('finds one created in a file nothing imports', () => {
    const { roots } = read({
      'src/app.module.ts': `export class AppModule {}`,
      'src/worker/worker.module.ts': `export class WorkerModule {}`,
      'src/main.ts': `
        import { AppModule } from './app.module';
        await NestFactory.create(AppModule);
      `,
      'src/worker/main.ts': `
        import { WorkerModule } from './worker.module';
        await NestFactory.create(WorkerModule);
      `,
    });
    expect(roots.map((root) => root.name)).toEqual(['AppModule', 'WorkerModule']);
  });

  it('takes a microservice as an application of its own', () => {
    const { roots } = read({
      'src/queue.module.ts': `export class QueueModule {}`,
      'src/main.ts': `
        import { QueueModule } from './queue.module';
        await NestFactory.createMicroservice(QueueModule, { transport: 1 });
      `,
    });
    expect(roots.map((root) => root.name)).toEqual(['QueueModule']);
  });

  // A second transport on the application that already exists, not a second
  // application: it names no root module, and splitting one address space in two
  // would put every address of it in conflict with itself.
  it('does not take connectMicroservice as an application', () => {
    const { roots, unread } = read({
      'src/app.module.ts': `export class AppModule {}`,
      'src/main.ts': `
        import { AppModule } from './app.module';
        const app = await NestFactory.create(AppModule);
        app.connectMicroservice({ transport: 1 });
      `,
    });
    expect(roots.map((root) => root.name)).toEqual(['AppModule']);
    expect(unread).toEqual([]);
  });

  it('counts one module handed to the factory twice as one application', () => {
    const { roots } = read({
      'src/app.module.ts': `export class AppModule {}`,
      'src/main.ts': `
        import { AppModule } from './app.module';
        await NestFactory.create(AppModule);
      `,
      'src/serve.ts': `
        import { AppModule } from './app.module';
        await NestFactory.create(AppModule);
      `,
    });
    expect(roots.map((root) => root.name)).toEqual(['AppModule']);
  });

  it('distinguishes two roots of the same name by their file', () => {
    const { roots } = read({
      'apps/api/app.module.ts': `export class AppModule {}`,
      'apps/api/main.ts': `
        import { AppModule } from './app.module';
        await NestFactory.create(AppModule);
      `,
      'apps/jobs/app.module.ts': `export class AppModule {}`,
      'apps/jobs/main.ts': `
        import { AppModule } from './app.module';
        await NestFactory.create(AppModule);
      `,
    });
    expect(roots.map((root) => root.name)).toEqual([
      'AppModule~apps/api/app.module.ts',
      'AppModule~apps/jobs/app.module.ts',
    ]);
  });

  it('reports a factory call whose root module cannot be read', () => {
    const { roots, unread } = read({
      'src/main.ts': `await NestFactory.create(modules[which]);`,
    });
    expect(roots).toEqual([]);
    expect(unread).toHaveLength(1);
    const [row] = applicationFindings(unread);
    expect(row?.reason).toBe('application-root-unread');
    expect(row?.file).toBe('src/main.ts');
  });

  it('says nothing about a repository that creates nothing', () => {
    const { roots, unread } = read({ 'src/app.module.ts': `export class AppModule {}` });
    expect(roots).toEqual([]);
    expect(unread).toEqual([]);
  });
});

/** A module index filled by hand, in the shape the module pass leaves it in. */
const indexOf = (project: Project, declared: Record<string, { imports?: string[]; controllers?: string[] }>) => {
  const classes = buildClassIndex({ project, repo: 'svc', repoDir: ROOT });
  const modules = new ModuleIndex();
  const find = (name: string) => {
    const found = classes.byName(name)[0];
    if (found === undefined) throw new Error(`no class ${name}`);
    return found;
  };
  const infos: ModuleInfo[] = Object.entries(declared).map(([name, options]) => {
    const indexed = find(name);
    return {
      id: indexed.id,
      name: indexed.name,
      file: indexed.file,
      line: indexed.line,
      kind: 'static',
      declaration: indexed.declaration,
      controllers: (options.controllers ?? []).map((each) => find(each).declaration),
      providers: [],
      providedByImports: [],
      exports: [],
      imports: (options.imports ?? []).map((each) => {
        const target = find(each);
        return { id: target.id, declaration: target.declaration, kind: 'static' as const, name: target.name };
      }),
    };
  });
  for (const info of infos) modules.add(info);
  return { classes, modules, find };
};

describe('which application mounts what', () => {
  const FILES = {
    'src/api.module.ts': `
      import { Module } from '@nestjs/common';
      @Module({}) export class ApiModule {}
    `,
    'src/health.module.ts': `
      import { Module } from '@nestjs/common';
      @Module({}) export class HealthModule {}
    `,
    'src/worker.module.ts': `
      import { Module } from '@nestjs/common';
      @Module({}) export class WorkerModule {}
    `,
    'src/health.controller.ts': `
      import { Controller } from '@nestjs/common';
      @Controller('health') export class HealthController {}
    `,
    'src/status.controller.ts': `
      import { Controller } from '@nestjs/common';
      @Controller('status') export class StatusController {}
    `,
  };

  const membership = () => {
    const project = repoOf(FILES);
    const { classes, modules, find } = indexOf(project, {
      ApiModule: { imports: ['HealthModule'], controllers: ['StatusController'] },
      HealthModule: { controllers: ['HealthController'] },
      WorkerModule: { controllers: ['StatusController'] },
    });
    const roots = ['ApiModule', 'WorkerModule'].map((name) => {
      const indexed = find(name);
      return { name, module: indexed.declaration, file: 'src/main.ts', line: 1 };
    });
    return {
      map: applicationMembership(roots, modules, classes),
      idOf: (name: string) => find(name).id,
    };
  };

  it('reaches a controller through an import, transitively', () => {
    const { map, idOf } = membership();
    expect(map.of[idOf('HealthController')]).toEqual(['ApiModule']);
  });

  it('gives a controller both applications that mount it', () => {
    const { map, idOf } = membership();
    expect(map.of[idOf('StatusController')]).toEqual(['ApiModule', 'WorkerModule']);
  });

  it('names every application it read', () => {
    const { map } = membership();
    expect(map.names).toEqual(['ApiModule', 'WorkerModule']);
  });

  it('says nothing about a class no application reaches', () => {
    const project = repoOf(FILES);
    const { classes, modules, find } = indexOf(project, {
      ApiModule: {},
      HealthModule: { controllers: ['HealthController'] },
      WorkerModule: {},
    });
    const map = applicationMembership(
      [{ name: 'ApiModule', module: find('ApiModule').declaration, file: 'src/main.ts', line: 1 }],
      modules,
      classes,
    );
    expect(map.of[find('HealthController').id]).toBeUndefined();
    expect(map.names).toEqual(['ApiModule']);
  });
});

describe('how an application orders its routes (P385)', () => {
  const orderOf = (main: string) =>
    read({ 'src/app.module.ts': `export class AppModule {}`, 'src/main.ts': `import { AppModule } from './app.module';\n${main}` }).roots[0]?.routeOrder;

  it('leaves the default, the Express adapter in declaration order, unsaid', () => {
    expect(orderOf(`await NestFactory.create(AppModule);`)).toBeUndefined();
    expect(orderOf(`await NestFactory.create(AppModule, { cors: true });`)).toBeUndefined();
    expect(orderOf(`await NestFactory.create(AppModule, new ExpressAdapter(server));`)).toBeUndefined();
  });

  it('reads Fastify by its adapter or its application type as ranking by specificity', () => {
    expect(orderOf(`await NestFactory.create(AppModule, new FastifyAdapter());`)).toBe('specificity');
    expect(orderOf(`const adapter = new FastifyAdapter();\nawait NestFactory.create(AppModule, adapter);`)).toBe('specificity');
    expect(orderOf(`await NestFactory.create<NestFastifyApplication>(AppModule, adapter);`)).toBe('specificity');
  });

  it('reads routeResolutionStrategy in the options', () => {
    expect(orderOf(`await NestFactory.create(AppModule, { routeResolutionStrategy: 'specificity' });`)).toBe('specificity');
    expect(orderOf(`await NestFactory.create(AppModule, new ExpressAdapter(), { routeResolutionStrategy: 'specificity' });`)).toBe('specificity');
    expect(orderOf(`await NestFactory.create(AppModule, { routeResolutionStrategy: 'declaration' });`)).toBeUndefined();
  });

  it('says unread where the adapter or the options cannot be read', () => {
    expect(orderOf(`await NestFactory.create(AppModule, makeAdapter());`)).toBe('unread');
    expect(orderOf(`await NestFactory.create(AppModule, { ...options });`)).toBe('unread');
    expect(orderOf(`await NestFactory.create(AppModule, { routeResolutionStrategy: strategy });`)).toBe('unread');
  });
});

describe('the order controllers register their routes in (P385)', () => {
  const FILES = {
    'src/app.module.ts': `@Module({}) export class AppModule {}`,
    'src/orders.module.ts': `@Module({}) export class OrdersModule {}`,
    'src/billing.module.ts': `@Module({}) export class BillingModule {}`,
    'src/shared.module.ts': `@Module({}) export class SharedModule {}`,
    'src/root.controller.ts': `@Controller() export class RootController {}`,
    'src/orders.controller.ts': `@Controller('orders') export class OrdersController {}`,
    'src/exports.controller.ts': `@Controller('orders') export class ExportsController {}`,
    'src/billing.controller.ts': `@Controller('billing') export class BillingController {}`,
    'src/shared.controller.ts': `@Controller('shared') export class SharedController {}`,
  };

  it('takes the root, then each import depth first in the order written, each module once', () => {
    const project = repoOf(FILES);
    const { classes, modules, find } = indexOf(project, {
      AppModule: { imports: ['OrdersModule', 'BillingModule'], controllers: ['RootController'] },
      OrdersModule: { imports: ['SharedModule'], controllers: ['OrdersController', 'ExportsController'] },
      BillingModule: { imports: ['SharedModule'], controllers: ['BillingController'] },
      SharedModule: { controllers: ['SharedController'] },
    });
    const registration = routeRegistrationOf(
      [{ name: 'AppModule', module: find('AppModule').declaration, file: 'src/main.ts', line: 1 }],
      modules,
      classes,
    );
    expect(registration.roots[0]?.controllers).toEqual(
      ['RootController', 'OrdersController', 'ExportsController', 'SharedController', 'BillingController'].map((name) => find(name).id),
    );
  });
});
