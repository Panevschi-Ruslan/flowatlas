import { Project, type ClassDeclaration } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decoratorModule,
  decoratorName,
  findDecorators,
  getDecorator,
  stringListArg,
} from './decorators.js';
import { evaluateExpression, stableKey } from './static-value.js';

const SOURCE = `
import { Controller, Get } from '@lib/http';
import { Controller as LocalController } from './local.js';

export enum Cron { HOURLY = '0 * * * *' }
const PREFIX = 'orders';
const buildPath = () => '/' + String(Math.random());
const ROUTES = { byId: ':id' } as const;

@Controller(PREFIX)
export class Real {
  @Get(':id') one() {}
  @Get(['a', 'b']) many() {}
  @Get() none() {}
  @Get(ROUTES.byId) fromConst() {}
  @Get(Cron.HOURLY) fromEnum() {}
  @Get(\`literal\`) fromTemplate() {}
  @Get(buildPath()) dynamic() {}
  @Get({ path: 'x', version: '2' }) object() {}
  @Get(1, true, null) mixed() {}
}

@LocalController('shadow')
export class Fake {}
`;

const LOCAL = `export const Controller = (path: string) => (target: unknown) => target;`;

describe('decorator reading', () => {
  let real: ClassDeclaration;
  let fake: ClassDeclaration;

  beforeAll(() => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('local.ts', LOCAL);
    const file = project.createSourceFile('svc.ts', SOURCE);
    const [first, second] = file.getClasses();
    if (first === undefined || second === undefined) throw new Error('fixture classes missing');
    real = first;
    fake = second;
  });

  const argOf = (methodName: string): ReturnType<typeof evaluateExpression> => {
    const method = real.getMethod(methodName);
    if (method === undefined) throw new Error(`no method ${methodName}`);
    const decorator = method.getDecorators()[0];
    if (decorator === undefined) throw new Error(`no decorator on ${methodName}`);
    const [argument] = decorator.getArguments();
    if (argument === undefined) throw new Error(`no argument on ${methodName}`);
    return evaluateExpression(argument);
  };

  it('reads a string literal', () => {
    expect(argOf('one')).toEqual({ resolved: true, value: ':id' });
  });

  it('reads an array of literals', () => {
    expect(argOf('many')).toEqual({ resolved: true, value: ['a', 'b'] });
  });

  it('reads a property of a constant object', () => {
    expect(argOf('fromConst')).toEqual({ resolved: true, value: ':id' });
  });

  it('reads an enum member', () => {
    expect(argOf('fromEnum')).toEqual({ resolved: true, value: '0 * * * *' });
  });

  it('reads a template literal with no substitutions', () => {
    expect(argOf('fromTemplate')).toEqual({ resolved: true, value: 'literal' });
  });

  it('reads an object literal', () => {
    expect(argOf('object')).toEqual({ resolved: true, value: { path: 'x', version: '2' } });
  });

  it('reads numbers, booleans and null', () => {
    const method = real.getMethod('mixed');
    const decorator = method?.getDecorators()[0];
    const values = decorator?.getArguments().map((argument) => evaluateExpression(argument));
    expect(values).toEqual([
      { resolved: true, value: 1 },
      { resolved: true, value: true },
      { resolved: true, value: null },
    ]);
  });

  it('refuses to guess a value that is not constant', () => {
    const value = argOf('dynamic');
    expect(value.resolved).toBe(false);
    if (!value.resolved) expect(value.text).toBe('buildPath()');
  });

  it('reports a decorator with no arguments as having none', () => {
    const method = real.getMethod('none');
    expect(method?.getDecorators()[0]?.getArguments()).toHaveLength(0);
  });

  it('names the decorator', () => {
    expect(real.getDecorators().map(decoratorName)).toEqual(['Controller']);
  });

  it('tells which module a decorator came from', () => {
    const onFake = fake.getDecorators()[0];
    expect(onFake).toBeDefined();
    if (onFake !== undefined) expect(decoratorModule(onFake)).toBe('./local.js');
  });

  it('matches by import source, not by name alone', () => {
    expect(getDecorator(fake, 'Controller', ['@lib/http'])).toBeUndefined();
    expect(getDecorator(fake, 'Controller', ['./local.js'])).toBeDefined();
    expect(getDecorator(fake, 'LocalController', ['./local.js'])).toBeDefined();
  });

  it('accepts a decorator whose source cannot be read', () => {
    // `@lib/http` is not installed in this in-memory project, so the source
    // is unknown; refusing it would drop real routes whenever a re-export hides
    // the origin.
    expect(getDecorator(real, 'Controller', ['@lib/http'])).toBeDefined();
  });

  it('finds every decorator of a family', () => {
    const methods = real.getMethods().flatMap((method) => findDecorators(method, { names: ['Get'] }));
    expect(methods).toHaveLength(9);
  });
});

describe('stringListArg', () => {
  it('accepts one string or an array of them', () => {
    expect(stringListArg({ resolved: true, value: 'a' })).toEqual(['a']);
    expect(stringListArg({ resolved: true, value: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('rejects anything else', () => {
    expect(stringListArg({ resolved: true, value: 1 })).toBeUndefined();
    expect(stringListArg({ resolved: true, value: ['a', 1] })).toBeUndefined();
    expect(stringListArg({ resolved: false, text: 'x', reason: 'r' })).toBeUndefined();
    expect(stringListArg(undefined)).toBeUndefined();
  });
});

describe('stableKey', () => {
  it('is the same whichever order the keys were written in', () => {
    expect(stableKey({ b: 2, a: 1 })).toBe(stableKey({ a: 1, b: 2 }));
  });

  it('quotes strings so a key is unambiguous', () => {
    expect(stableKey({ cmd: 'sum' })).toBe('{"cmd":"sum"}');
  });

  it('handles arrays and primitives', () => {
    expect(stableKey(['a', 1])).toBe('["a",1]');
    expect(stableKey('x')).toBe('"x"');
    expect(stableKey(5)).toBe('5');
  });
});
