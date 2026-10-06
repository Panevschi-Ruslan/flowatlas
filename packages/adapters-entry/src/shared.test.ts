import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  decoratorNames,
  decoratorsFrom,
  joinPath,
  packageOfCall,
} from './shared.js';

describe('joinPath', () => {
  it('joins a prefix, a controller path and a route path', () => {
    expect(joinPath('api', 'orders', ':id')).toBe('/api/orders/:id');
  });

  it('drops empty segments', () => {
    expect(joinPath(undefined, 'orders', '')).toBe('/orders');
    expect(joinPath('', '', '')).toBe('/');
  });

  it('collapses slashes wherever they came from', () => {
    expect(joinPath('/api/', '/orders/', '/:id')).toBe('/api/orders/:id');
  });

  it('keeps a wildcard', () => {
    expect(joinPath('api', 'files', '*')).toBe('/api/files/*');
  });

  it('returns the root when there is nothing to join', () => {
    expect(joinPath()).toBe('/');
    expect(joinPath(undefined, undefined)).toBe('/');
  });
});

describe('packageOfCall', () => {
  /** Every call written in one file, in the order it appears. */
  const callsIn = (source: string) => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
    return project
      .createSourceFile('/src/server.ts', source)
      .getDescendantsOfKind(SyntaxKind.CallExpression);
  };

  it('reads the package a helper was imported from, however the import is written', () => {
    const [byDefault, byName, bySubpath, byNamespace, ofItsOwn] = callsIn(`
      import mount from 'koa-mount';
      import { mount as hang } from '@scope/mounts';
      import { wrap } from '@scope/mounts/lib/wrap';
      import * as helpers from 'koa-helpers';
      const local = (value: unknown) => value;
      mount('/api', 1);
      hang('/auth', 2);
      wrap('/oauth', 3);
      helpers.mount('/mcp', 4);
      local(5);
    `);
    // The import statement is the source, not the checker: none of these packages
    // exists here, and every one of them is named in plain sight in the file.
    expect(packageOfCall(byDefault!)).toBe('koa-mount');
    expect(packageOfCall(byName!)).toBe('@scope/mounts');
    // A subpath import is an import of the package, so a description keyed on the
    // package matches both spellings of it.
    expect(packageOfCall(bySubpath!)).toBe('@scope/mounts');
    expect(packageOfCall(byNamespace!)).toBe('koa-helpers');
    // A helper of the repository's own comes from no package, which is what makes
    // it the case no record can describe.
    expect(packageOfCall(ofItsOwn!)).toBeUndefined();
  });
});

/** One class per source, decorated however the test needs. */
const classIn = (source: string, files: Record<string, string> = {}) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  return project.createSourceFile('/src/thing.ts', source).getClasses()[0]!;
};

describe('decoratorsFrom', () => {
  it('matches a decorator imported from a subpath of the package asked for', () => {
    const declaration = classIn(`
      import { Controller } from '@nestjs/common/decorators';
      @Controller('health')
      export class HealthController {}
    `);
    const found = decoratorsFrom(declaration, ['Controller'], ['@nestjs/common']);
    expect(found.matched).toHaveLength(1);
    expect(found.foreign).toEqual([]);
  });

  it('hands back a decorator it could not place, rather than dropping it', () => {
    const declaration = classIn(
      `
      import { Controller } from './framework/nest.js';
      @Controller('legacy')
      export class LegacyController {}
    `,
      { '/src/framework/nest.ts': "export { Controller } from '@nestjs/common';" },
    );
    const found = decoratorsFrom(declaration, ['Controller'], ['@nestjs/common']);
    expect(found.matched).toEqual([]);
    expect(found.foreign.map((item) => item.module)).toEqual(['./framework/nest.js']);
  });

  it('gives a decorator whose source cannot be read at all the benefit of the doubt', () => {
    const declaration = classIn(`
      declare const Controller: (path: string) => ClassDecorator;
      @Controller('local')
      export class LocalController {}
    `);
    const found = decoratorsFrom(declaration, ['Controller'], ['@nestjs/common']);
    // Refusing here would drop real routes wherever a re-export cannot be
    // followed, which is the reading core's own matcher settled on.
    expect(found.matched).toHaveLength(1);
  });

  it('says nothing about a class carrying no decorator of that name', () => {
    const declaration = classIn(`
      import { Injectable } from '@nestjs/common';
      @Injectable()
      export class Service {}
    `);
    expect(decoratorsFrom(declaration, ['Controller'], ['@nestjs/common'])).toEqual({
      matched: [],
      foreign: [],
    });
  });
});

describe('decoratorNames', () => {
  it('reads an aliased import under the name the package exports it as', () => {
    const declaration = classIn(`
      import { Get as HttpGet } from '@nestjs/common/decorators';
      export class C { @HttpGet('daily') daily() {} }
    `);
    const decorator = declaration.getMethods()[0]!.getDecorators()[0]!;
    expect(decoratorNames(decorator)).toContain('HttpGet');
    expect(decoratorNames(decorator)).toContain('Get');
  });

  it('gives one name where the import is not aliased', () => {
    const declaration = classIn(`
      import { Get } from '@nestjs/common';
      export class C { @Get() all() {} }
    `);
    expect(decoratorNames(declaration.getMethods()[0]!.getDecorators()[0]!)).toEqual(['Get']);
  });
});
