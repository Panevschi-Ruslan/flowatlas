import { Project, type ClassDeclaration, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveConstructorInjection, resolveFieldInjection } from './constructor.js';
import type { DiResolution, DiResolverOptions } from './types.js';

const LIB = `
export declare class Client { send(): void }
export declare function fromContainer<T>(token: unknown): T;
`;

const SOURCE = `
import { Client, fromContainer } from '@lib/kit';

export class Orders { create(): void {} }
export interface Clock { now(): number }

export class Handler {
  private readonly self = fromContainer(Orders);
  private readonly plain = 1;

  constructor(
    private readonly orders: Orders,
    private readonly client: Client,
    private readonly token: string,
    private readonly clock?: Clock,
  ) {}
}

export class NoConstructor {}
`;

let file: SourceFile;
let handler: ClassDeclaration;

const options: DiResolverOptions = {
  classIdOf: (declaration) => `repo#${declaration.getName()}`,
  externalIdOf: (ref) => `repo#${ref.package}:${ref.typeName}`,
};

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@lib/kit/index.d.ts', LIB);
  file = project.createSourceFile('handler.ts', SOURCE);
  const found = file.getClass('Handler');
  if (found === undefined) throw new Error('fixture class missing');
  handler = found;
});

const resolutionOf = (index: number, extra: Partial<DiResolverOptions> = {}): DiResolution => {
  const entry = resolveConstructorInjection(handler, { ...options, ...extra })[index];
  if (entry === undefined) throw new Error(`no parameter ${index}`);
  return entry.resolution;
};

describe('constructor injection', () => {
  it('resolves a parameter whose type is a class of this repository', () => {
    expect(resolutionOf(0)).toMatchObject({ kind: 'class', id: 'repo#Orders' });
  });

  it('resolves a parameter whose type comes from an installed package', () => {
    expect(resolutionOf(1)).toMatchObject({
      kind: 'external',
      id: 'repo#@lib/kit:Client',
      package: '@lib/kit',
      typeName: 'Client',
    });
  });

  it('reports a parameter whose type names no class, and never throws', () => {
    const resolution = resolutionOf(2);
    expect(resolution).toMatchObject({ kind: 'unresolved', reason: 'di-type-unresolved' });
    if (resolution.kind === 'unresolved') {
      expect(resolution.hint).toBe('Inject a class this repository declares.');
    }
  });

  it('says an optional parameter was expected to have nothing behind it', () => {
    const resolution = resolutionOf(3);
    if (resolution.kind !== 'unresolved') throw new Error('expected unresolved');
    expect(resolution.hint).toContain('Optional parameter');
  });

  it('takes the hint for a missing class from the extractor', () => {
    const resolution = resolutionOf(2, { injectHint: 'Name the provider.' });
    if (resolution.kind !== 'unresolved') throw new Error('expected unresolved');
    expect(resolution.hint).toBe('Name the provider.');
  });

  it('lets an annotation have the final say over the declared type', () => {
    const resolution = resolutionOf(0, {
      tokenResolver: () => ({ kind: 'token', id: 'repo#TOKEN', token: 'TOKEN', provider: 'useValue' }),
    });
    expect(resolution).toMatchObject({ kind: 'token', token: 'TOKEN' });
  });

  it('records how each entry was decided', () => {
    const entries = resolveConstructorInjection(handler, {
      ...options,
      tokenResolver: (parameter) =>
        parameter.getName() === 'token'
          ? { kind: 'unresolved', reason: 'di-token-unknown', hint: 'Register it.', text: 'TOKEN' }
          : undefined,
    });
    expect(entries.map((entry) => entry.via)).toEqual(['type', 'type', 'token', 'type']);
    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2, 3]);
  });

  it('has nothing to resolve for a class with no constructor', () => {
    const declaration = file.getClass('NoConstructor');
    if (declaration === undefined) throw new Error('fixture class missing');
    expect(resolveConstructorInjection(declaration, options)).toEqual([]);
  });
});

describe('field injection', () => {
  it('finds nothing until an extractor says what a field asking for itself looks like', () => {
    expect(resolveFieldInjection(handler, options)).toEqual([]);
  });

  it('populates an entry through the hook, marked as coming from a field', () => {
    const entries = resolveFieldInjection(handler, {
      ...options,
      fieldInjectResolver: (property) =>
        property.getName() === 'self'
          ? { kind: 'class', id: 'repo#Orders', declaration: file.getClassOrThrow('Orders') }
          : undefined,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ property: 'self', index: null, via: 'field-inject' });
  });
});
