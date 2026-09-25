import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  declaredParameterType,
  entityNameOf,
  packageOfPath,
  resolveTypeOrigin,
  stripWrapperSuffix,
  unwrapDelivery,
  writtenKeysOf,
} from './origin.js';

const SOURCE = `
import { Repository } from 'some-orm';
import { Client } from '@scope/driver';

export interface Order { id: string }
export class OrdersRepository { find(): Order[] { return [] } }
export class BaseRepository<Entity> { protected rows: Entity[] = [] }
export class OrdersStore extends BaseRepository<Order> {}
export class WrappedClient extends Client {}

export class Api {
  fromPackage!: Repository<Order>;
  scoped!: Client;
  local!: OrdersRepository;
  overBase!: OrdersStore;
  wrapping!: WrappedClient;
  awaited!: Promise<Repository<Order>>;
  intersected!: Repository<Order> & { $client: Client };
  bolted!: { $client: Client } & Repository<Order>;
  plain!: string;
}
`;

const ORM = `export declare class Repository<Entity> { find(): Promise<Entity[]> }`;
const DRIVER = `export declare class Client { send(): void }`;

let file: SourceFile;

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/some-orm/index.d.ts', ORM);
  project.createSourceFile('node_modules/@scope/driver/index.d.ts', DRIVER);
  file = project.createSourceFile('api.ts', SOURCE);
});

describe('where a type came from', () => {

  const of = (property: string, options?: Parameters<typeof resolveTypeOrigin>[1]) =>
    resolveTypeOrigin(file.getClassOrThrow('Api').getPropertyOrThrow(property), options);

  it('names the package that declares the type', () => {
    expect(of('fromPackage')).toMatchObject({ package: 'some-orm', typeName: 'Repository' });
  });

  it('keeps both segments of a scoped package', () => {
    expect(of('scoped')?.package).toBe('@scope/driver');
  });

  it('says a type declared here is local', () => {
    expect(of('local')).toMatchObject({ package: null, isLocal: true, typeName: 'OrdersRepository' });
  });

  it('reads the entity out of the type arguments', () => {
    const origin = of('fromPackage');
    expect(origin).not.toBeNull();
    if (origin !== null) expect(entityNameOf(origin)).toBe('Order');
  });

  it('sees through a promise', () => {
    expect(of('awaited')).toMatchObject({ package: 'some-orm', typeName: 'Repository' });
  });

  it('recognises a base class named in the configuration', () => {
    expect(of('overBase', { localBaseClasses: ['BaseRepository'] })).toMatchObject({
      package: 'local:BaseRepository',
      isLocal: true,
    });
    const origin = of('overBase', { localBaseClasses: ['BaseRepository'] });
    if (origin !== null) expect(entityNameOf(origin)).toBe('Order');
  });

  it('leaves that base alone when the configuration does not name it', () => {
    expect(of('overBase')?.package).toBeNull();
  });

  it('follows a class of one own that wraps one from a package', () => {
    expect(of('wrapping')).toMatchObject({ package: '@scope/driver', typeName: 'Client' });
  });

  it('says nothing about a primitive', () => {
    expect(of('plain')).toBeNull();
  });

  /**
   * An intersection has no symbol of its own, so before R53 every receiver
   * typed as one answered null: no package, no descriptor, no table. That is
   * how a modern database client is handed out, so it was not a corner case.
   */
  it('reads the package out of an intersection', () => {
    const origin = of('intersected');
    expect(origin).toMatchObject({ package: 'some-orm', typeName: 'Repository' });
    if (origin !== null) expect(entityNameOf(origin)).toBe('Order');
  });

  it('picks the same member whichever half was written first', () => {
    // The anonymous `{ $client }` is the bolt-on, not the client, and which one
    // answers must not depend on the order the author typed them in.
    expect(of('bolted')).toMatchObject({ package: 'some-orm', typeName: 'Repository' });
  });
});

describe('packageOfPath', () => {
  it('reads the package out of a path', () => {
    expect(packageOfPath('/repo/node_modules/data-layer/index.d.ts')).toBe('data-layer');
  });

  it('keeps both segments of a scoped name', () => {
    expect(packageOfPath('/repo/node_modules/@scope/data/index.d.ts')).toBe('@scope/data');
  });

  it('takes the innermost package when a store nests them', () => {
    expect(
      packageOfPath('/repo/node_modules/.store/data-layer@0.3.20/node_modules/data-layer/index.d.ts'),
    ).toBe('data-layer');
  });

  it('says nothing about a path with no package in it', () => {
    expect(packageOfPath('/repo/src/orders.ts')).toBeNull();
  });
});

describe('stripWrapperSuffix', () => {
  it.each([
    ['OrderDocument', 'Order'],
    ['OrderEntity', 'Order'],
    ['OrderSchema', 'Order'],
    ['OrderModel', 'Order'],
    ['Order', 'Order'],
    ['Document', 'Document'],
  ])('turns %s into %s', (input, expected) => {
    expect(stripWrapperSuffix(input)).toBe(expected);
  });
});

describe('unwrapDelivery', () => {
  it('leaves a type that is not wrapped alone', () => {
    const property = file.getClassOrThrow('Api').getPropertyOrThrow('plain');
    expect(unwrapDelivery(property.getType()).getText()).toBe('string');
  });
});

/**
 * Which keys a call puts on the wire, as against which it is allowed to.
 *
 * Reading the keys off the literal's *type* is the whole of R34 wearing a
 * disguise: the type of `{ ...patch }` where `patch` is a `Partial<T>` names
 * every key of `T`, and the call may write none of them. A spread that cannot
 * be pinned down has to refuse the literal rather than contribute a guess.
 */
describe('the keys an object written at a call site puts on the wire', () => {
  const written = (body: string): string[] | undefined => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const file = project.createSourceFile(
      'w.ts',
      [
        'interface Item { a: string; b: number; c: boolean }',
        'interface Full { x: string; y: number }',
        'declare function send(body: unknown): void;',
        'declare const patch: Partial<Item>;',
        'declare const full: Full;',
        'declare const cond: boolean;',
        `send(${body});`,
      ].join('\n'),
    );
    const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).at(-1);
    return writtenKeysOf([call!.getArguments()[0]!]);
  };

  it('answers with what the literal writes', () => {
    expect(written("{ a: 'one', b: 2 }")).toEqual(['a', 'b']);
  });

  it('counts the keys a spread certainly carries', () => {
    // Every field of `Full` is required, so spreading it really does put them
    // all there. This is the case the contract fixture rests on.
    expect(written('{ ...full, extra: 1 }')).toEqual(['extra', 'x', 'y']);
  });

  it('refuses a spread of a shape that may be missing its keys', () => {
    // `Partial<Item>` permits a, b and c and guarantees none of them. Reading
    // the literal's type said all three were written, and the message built on
    // it said the call "always sent" them (R34).
    expect(written('{ ...patch }')).toBeUndefined();
    expect(written("{ a: 'one', ...patch }")).toBeUndefined();
  });

  it('refuses a spread that depends on a condition', () => {
    expect(written("{ a: 'one', ...(cond ? { b: 1 } : {}) }")).toBeUndefined();
  });

  it('answers with nothing when there is no object to read', () => {
    expect(written('patch')).toBeUndefined();
    expect(writtenKeysOf([])).toBeUndefined();
  });
});


/**
 * A rest parameter is the array the callee is handed, never the thing one call
 * site passes. A socket library declares `emit(event: string, ...args: any[])`,
 * and reading that back as the payload answered `any[]` - which is not `any`,
 * so the `any`/`unknown` guard let it through - and discarded the one argument
 * with a shape in it.
 */
describe('the declared type of an argument', () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const source = project.createSourceFile(
    'rest.ts',
    [
      'interface Sent { id: string }',
      'declare class Transport {',
      '  emit(event: string, ...args: any[]): void;',
      '  publish(event: string, ...events: Sent[]): void;',
      '  send(body: Sent): void;',
      '}',
      'declare const transport: Transport;',
      "transport.emit('created', { id: 'a' } as Sent);",
      "transport.publish('created', { id: 'a' } as Sent, { id: 'b' } as Sent);",
      "transport.send({ id: 'a' });",
    ].join('\n'),
  );
  const checker = project.getTypeChecker();
  const calls = source.getDescendantsOfKind(SyntaxKind.CallExpression);
  const declaredAt = (at: number, index: number) =>
    declaredParameterType(calls[at]!, index, checker as never)?.getText();

  it('refuses a rest parameter that promises nothing', () => {
    // `any[]` is not `any`, which is exactly why this slipped through: the
    // caller falls back to the argument written at the call site only when the
    // declaration says nothing, and the array made it look as though it had.
    expect(declaredAt(0, 1)).toBeUndefined();
  });

  it('answers with the element a rest parameter collects, not the array', () => {
    expect(declaredAt(1, 1)).toBe('Sent');
  });

  it('keeps answering past the end of the declared list while one collects', () => {
    expect(declaredAt(1, 2)).toBe('Sent');
  });

  it('leaves an ordinary parameter as it is', () => {
    expect(declaredAt(2, 0)).toBe('Sent');
  });

  it('says nothing about a position no parameter takes', () => {
    expect(declaredAt(2, 1)).toBeUndefined();
  });
});
