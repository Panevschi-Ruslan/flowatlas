import { Project, type SourceFile } from 'ts-morph';
import { beforeEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from '../builder.js';
import type { Unresolved } from '../model/graph.js';
import { TypeCollector } from './collector.js';

const SOURCE = `
export class Observable<T> { private v!: T }

export interface Money { amount: number; currency: string }
export interface Line { sku: string; qty: number; price: Money }
export interface Cart { id: string; lines: Line[]; note?: string }
export interface Node2 { name: string; children: Node2[] }
export interface Left { right: Right }
export interface Right { left: Left }
export enum Status { New = 'NEW', Paid = 'PAID' }
export type Kind = 'retail' | 'wholesale';
export interface Base { id: string }
export interface Derived extends Base { extra: boolean }

export class Api {
  plain(): Cart { return null as never }
  awaited(): Promise<Cart> { return null as never }
  streamed(): Observable<Cart> { return null as never }
  both(): Promise<Observable<Cart[]>> { return null as never }
  nothing(): Promise<void> { return null as never }
  literalReturn(): { a: string; b?: number } { return null as never }
  takes(a: string, b: Money, c?: number): void {}
  unioned(): Cart | null { return null as never }
  enumed(): Status { return Status.New }
  kinded(): Kind { return 'retail' }
  derived(): Derived { return null as never }
  recursive(): Node2 { return null as never }
  mutual(): Left { return null as never }
  tuple(): [string, number] { return null as never }
  mapped(): Map<string, Money> { return null as never }
  partial(): Partial<Money> { return null as never }
}
`;

describe('TypeCollector', () => {
  let file: SourceFile;
  let builder: GraphBuilder;
  let collector: TypeCollector;
  let reported: Unresolved[];

  beforeEach(() => {
    const project = new Project({ useInMemoryFileSystem: true });
    file = project.createSourceFile('api.ts', SOURCE);
    builder = new GraphBuilder({ repo: 'orders', generatedAt: '2026-01-01T00:00:00.000Z' });
    reported = [];
    collector = new TypeCollector({
      builder,
      repo: 'orders',
      report: (row) => reported.push(row),
    });
  });

  const method = (name: string) => {
    const found = file.getClassOrThrow('Api').getMethodOrThrow(name);
    return found;
  };

  const returnRef = (name: string): string =>
    collector.collectSignature(method(name)).returns;

  const registry = () => {
    collector.finalize();
    return builder.build().types;
  };

  it('names a declared type by reference rather than writing it out', () => {
    expect(returnRef('plain')).toBe('type:orders#Cart');
  });

  it('sees through a promise', () => {
    expect(returnRef('awaited')).toBe('type:orders#Cart');
  });

  it('sees through a stream', () => {
    expect(returnRef('streamed')).toBe('type:orders#Cart');
  });

  it('sees through a promise of a stream, and keeps the array', () => {
    expect(returnRef('both')).toBe('type:orders#Cart[]');
  });

  it('keeps void as void', () => {
    expect(returnRef('nothing')).toBe('void');
  });

  it('writes an anonymous shape out in place', () => {
    expect(returnRef('literalReturn')).toBe('{a:string;b?:number}');
  });

  it('collects the parameters of a signature in order', () => {
    expect(collector.collectSignature(method('takes')).params).toEqual([
      'string',
      'type:orders#Money',
      'number|undefined',
    ]);
  });

  it('keeps a union a union', () => {
    expect(returnRef('unioned')).toBe('null|type:orders#Cart');
  });

  it('records an enum with its values', () => {
    expect(returnRef('enumed')).toBe('type:orders#Status');
    const entry = registry()['type:orders#Status'];
    expect(entry?.kind).toBe('enum');
    expect(entry?.members).toEqual(['NEW', 'PAID']);
  });

  it('records an alias of literals as a union', () => {
    expect(returnRef('kinded')).toBe('type:orders#Kind');
    const entry = registry()['type:orders#Kind'];
    expect(entry?.kind).toBe('union');
    expect(entry?.members?.sort()).toEqual(["'retail'", "'wholesale'"]);
  });

  it('flattens what a type inherits, and remembers where it came from', () => {
    returnRef('derived');
    const entry = registry()['type:orders#Derived'];
    expect(entry?.fields?.map((f) => f.name).sort()).toEqual(['extra', 'id']);
    expect(entry?.meta?.['extends']).toEqual(['type:orders#Base']);
  });

  it('registers a type that contains itself exactly once', () => {
    returnRef('recursive');
    const types = registry();
    expect(Object.keys(types).filter((id) => id.endsWith('Node2'))).toEqual(['type:orders#Node2']);
    expect(types['type:orders#Node2']?.fields?.find((f) => f.name === 'children')?.type).toBe(
      'type:orders#Node2[]',
    );
  });

  it('registers two types that contain each other, and terminates', () => {
    returnRef('mutual');
    const types = registry();
    expect(types['type:orders#Left']).toBeDefined();
    expect(types['type:orders#Right']).toBeDefined();
  });

  it('keeps a tuple a tuple', () => {
    expect(returnRef('tuple')).toBe('[string,number]');
  });

  it('writes a built-in container as a reference with its arguments', () => {
    expect(returnRef('mapped')).toBe('Map<string,type:orders#Money>');
  });

  it('writes a utility type out from the properties it ends up with', () => {
    expect(returnRef('partial')).toBe('{amount?:number;currency?:string}');
  });

  it('registers each declared type once, whatever reached it', () => {
    returnRef('plain');
    returnRef('awaited');
    const types = registry();
    expect(Object.keys(types).filter((id) => id.endsWith('#Cart'))).toHaveLength(1);
  });

  it('gives every entry a hash once everything is known', () => {
    returnRef('plain');
    for (const entry of Object.values(registry())) {
      expect(entry.structuralHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('says when it stopped writing a shape out', () => {
    const shallow = new TypeCollector({
      builder: new GraphBuilder({ repo: 'orders' }),
      repo: 'orders',
      maxDepth: 0,
      report: (row) => reported.push(row),
    });
    shallow.collectType(method('literalReturn').getReturnType(), method('literalReturn'));
    expect(reported.map((row) => row.reason)).toContain('type-depth-exceeded');
    expect(reported.find((row) => row.reason === 'type-depth-exceeded')?.level).toBe('info');
  });
});

describe('two declarations of one name', () => {
  it('get separate ids, so neither is described as the other', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('a/order.ts', 'export interface Order { id: string }');
    project.createSourceFile('b/order.ts', 'export interface Order { total: number }');
    const file = project.createSourceFile(
      'api.ts',
      `import { Order as A } from './a/order.js';
       import { Order as B } from './b/order.js';
       export class Api { first(): A { return null as never } second(): B { return null as never } }`,
    );
    const builder = new GraphBuilder({ repo: 'orders', generatedAt: '2026-01-01T00:00:00.000Z' });
    const collector = new TypeCollector({ builder, repo: 'orders' });
    const api = file.getClassOrThrow('Api');

    const first = collector.collectSignature(api.getMethodOrThrow('first')).returns;
    const second = collector.collectSignature(api.getMethodOrThrow('second')).returns;

    expect(first).not.toBe(second);
    collector.finalize();
    const types = builder.build().types;
    expect(types[first]?.fields?.map((field) => field.name)).toEqual(['id']);
    expect(types[second]?.fields?.map((field) => field.name)).toEqual(['total']);
    expect(second).toContain('@');
  });
});
