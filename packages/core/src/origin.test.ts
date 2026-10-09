import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  boundDeclaration,
  declaredParameterType,
  entityNameOf,
  originOfValue,
  packageOfPath,
  resolveTypeOrigin,
  stripWrapperSuffix,
  unwrapDelivery,
  writtenKeysOf,
} from './origin.js';
import { evaluateExpression } from './static-value.js';

const SOURCE = `
import { Repository } from 'some-orm';
import { Client } from '@scope/driver';
import { Socket } from '@scope/sockets';
import type { ReadonlyCookies } from '@scope/framework';

/**
 * An alias of this repository's own over a library's type, which is how a
 * project names the socket it has authenticated.
 */
export type SocketWithAuthentication = Socket & { user: { id: string } };

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
  localAlias!: SocketWithAuthentication;
  packagedAlias!: ReadonlyCookies;
  plain!: string;
}
`;

const ORM = `export declare class Repository<Entity> { find(): Promise<Entity[]> }`;
const DRIVER = `export declare class Client { send(): void }`;
const SOCKETS = `export declare class Socket { on(event: string): void }`;

/**
 * A package that names an intersection of its own, which is the case the alias
 * rule exists for: the alias is where the framework declares its cookie store,
 * and the framework is the better answer than either member.
 */
const FRAMEWORK = `
export declare class CookieStore { get(name: string): string }
export type ReadonlyCookies = CookieStore & { readonly readonly: true };
`;

/** The same alias, alone, for the one case that needs files on a real disk. */
const ON_DISK = `
import { Socket } from '@scope/sockets';

type SocketWithAuthentication = Socket & { user: { id: string } };

export class Api {
  localAlias!: SocketWithAuthentication;
}
`;

let file: SourceFile;

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/some-orm/index.d.ts', ORM);
  project.createSourceFile('node_modules/@scope/driver/index.d.ts', DRIVER);
  project.createSourceFile('node_modules/@scope/sockets/index.d.ts', SOCKETS);
  project.createSourceFile('node_modules/@scope/framework/index.d.ts', FRAMEWORK);
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

  /**
   * The two halves of the alias rule, which are the same shape and want
   * opposite answers.
   *
   * An alias a package declares is where that package keeps the type, so the
   * alias answers. An alias this repository declares over a library's type
   * names nothing a reader can look up, and the library inside it is the whole
   * of what can be said about where the value came from.
   */
  it('looks through an alias of this repository own to the library inside it', () => {
    expect(of('localAlias')).toMatchObject({ package: '@scope/sockets', typeName: 'Socket' });
  });

  /**
   * The same case on a real directory with a manifest above it, which is what
   * every repository is.
   *
   * Worth a second test, and worth the files on disk that it costs. The first
   * version of this rule asked the *nearest manifest* whether the alias was
   * packaged, and a repository's own manifest answers yes — so the rule was inert
   * on every real repository while the test above passed, because an in-memory
   * file system has no manifest for that question to find. A test that cannot
   * tell the two versions apart is not a test of the rule.
   */
  it('still looks through it in a directory with a manifest of its own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowatlas-origin-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{ "name": "the-repository" }');
      mkdirSync(join(dir, 'node_modules', '@scope', 'sockets'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', '@scope', 'sockets', 'index.d.ts'), SOCKETS);
      writeFileSync(
        join(dir, 'node_modules', '@scope', 'sockets', 'package.json'),
        '{ "name": "@scope/sockets", "types": "index.d.ts" }',
      );
      const project = new Project({ compilerOptions: { skipLibCheck: true } });
      const local = project.createSourceFile(join(dir, 'app.ts'), ON_DISK);
      const property = local.getClassOrThrow('Api').getPropertyOrThrow('localAlias');
      expect(resolveTypeOrigin(property)).toMatchObject({ package: '@scope/sockets' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps an alias a package declares, because the package is the answer', () => {
    expect(of('packagedAlias')).toMatchObject({
      package: '@scope/framework',
      typeName: 'ReadonlyCookies',
    });
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

describe('a value named through a namespace and through names bound to names (R168)', () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  project.createSourceFile('/ops/returns.ts', 'export const processReturns = async () => {};\nexport let reassigned = processReturns;');
  project.createSourceFile('/ops/index.ts', "export * from './returns';\nexport { processReturns as renamed } from './returns';");
  const handlers = project.createSourceFile(
    '/handlers.ts',
    [
      "import * as ops from './ops';",
      'export const viaProperty = ops.processReturns;',
      "export const viaBrackets = ops['renamed'];",
      'export const viaTwoNames = viaProperty;',
      'export const viaReassigned = ops.reassigned;',
      'export const computed = ops[String(1)];',
    ].join('\n'),
  );
  const value = (name: string) => handlers.getVariableDeclarationOrThrow(name).getInitializerOrThrow();
  const declared = (name: string) => boundDeclaration(handlers.getVariableDeclarationOrThrow(name));
  const target = project.getSourceFileOrThrow('/ops/returns.ts').getVariableDeclarationOrThrow('processReturns');

  it('reads `ns.name` and `ns[\'name\']` through `export *` and `export { x as y } from`', () => {
    for (const name of ['viaProperty', 'viaBrackets']) {
      const origin = originOfValue(value(name));
      expect(origin.kind).toBe('local');
      expect(origin.kind === 'local' ? origin.declaration : undefined).toBe(target);
    }
  });

  it('names nothing with a key that is not written out', () => {
    expect(originOfValue(value('computed')).kind).toBe('unknown');
  });

  it('follows a const bound to a name to what that name declares, through several', () => {
    expect(declared('viaProperty')).toBe(target);
    expect(declared('viaTwoNames')).toBe(target);
  });

  it('reads a constant written in brackets the way it reads one written with a dot', () => {
    const file = project.createSourceFile('/topics.ts', "const TOPICS = { opened: 'loans-opened' };\nexport const a = TOPICS['opened'];\nexport const b = TOPICS.opened;");
    for (const name of ['a', 'b']) {
      expect(evaluateExpression(file.getVariableDeclarationOrThrow(name).getInitializerOrThrow())).toEqual({ resolved: true, value: 'loans-opened' });
    }
  });

  it('stops at a binding that is not a const, which holds whatever was assigned last', () => {
    expect(declared('viaReassigned')).toBe(project.getSourceFileOrThrow('/ops/returns.ts').getVariableDeclarationOrThrow('reassigned'));
  });
});
