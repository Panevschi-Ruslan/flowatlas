import { Node, Project, type ClassDeclaration, type Node as TsNode, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { findMethod, forEachCall, resolveReceiver } from './member-call.js';
import { DiMap } from './types.js';

const LIB = `export declare class Client { send(): void }`;

const SOURCE = `
import { Client } from '@lib/kit';

export class Orders {
  create(): void {}
  readonly other = new Orders();
}

export class Base { shared(): void {} }

export class Handler extends Base {
  private readonly orders!: Orders;
  private readonly client!: Client;
  private readonly loose!: unknown;

  own(): void {}

  run(): void {
    this.orders.create();
    this.own();
    this.orders.other.create();
    this.orders?.create();
    this.client.send();
    this.loose.whatever();
    super.shared();
    [1].map((n) => n);
  }
}
`;

let file: SourceFile;
let handler: ClassDeclaration;
let di: DiMap;

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@lib/kit/index.d.ts', LIB);
  file = project.createSourceFile('handler.ts', SOURCE);
  handler = file.getClassOrThrow('Handler');
  di = new DiMap();
  di.set(handler, {
    property: 'orders',
    index: 0,
    via: 'type',
    resolution: { kind: 'class', id: 'repo#Orders', declaration: file.getClassOrThrow('Orders') },
  });
});

/** Every call written in `Handler.run`, in the order it appears. */
const calls = (): ReturnType<typeof collect> => collect();

/**
 * The two questions every caller of this module asks together: what the
 * receiver is, and which method of it a name reaches. Composed here as the
 * passes compose them, rather than behind a third function nothing calls.
 */
const reaches = (call: TsNode): { classDecl: ClassDeclaration; methodName: string } | null => {
  if (!Node.isCallExpression(call)) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const receiver = resolveReceiver(callee.getExpression(), handler, di);
  if (receiver.classDecl === undefined) return null;
  const found = findMethod(receiver.classDecl, callee.getName());
  return found.method === undefined
    ? null
    : { classDecl: receiver.classDecl, methodName: callee.getName() };
};

const collect = () => {
  const out: Array<{ text: string; resolved: ReturnType<typeof reaches> }> = [];
  const body = handler.getMethodOrThrow('run').getBodyOrThrow();
  forEachCall(body, (call) => {
    out.push({ text: call.getText(), resolved: reaches(call) });
  });
  return out;
};

describe('following a call to the method it reaches', () => {
  it('resolves a call on an injected property', () => {
    const found = calls().find((call) => call.text === 'this.orders.create()');
    expect(found?.resolved?.methodName).toBe('create');
    expect(found?.resolved?.classDecl.getName()).toBe('Orders');
  });

  it('resolves a call on the class itself', () => {
    const found = calls().find((call) => call.text === 'this.own()');
    expect(found?.resolved?.methodName).toBe('own');
    expect(found?.resolved?.classDecl.getName()).toBe('Handler');
  });

  it('resolves a call written through optional chaining', () => {
    const found = calls().find((call) => call.text === 'this.orders?.create()');
    expect(found?.resolved?.methodName).toBe('create');
  });

  it('follows a chain the checker can type all the way down', () => {
    const found = calls().find((call) => call.text === 'this.orders.other.create()');
    expect(found?.resolved?.classDecl.getName()).toBe('Orders');
  });

  it('refuses a receiver the checker will not commit to', () => {
    const found = calls().find((call) => call.text === 'this.loose.whatever()');
    expect(found?.resolved).toBeNull();
  });

  it('walks past a class the repository does not declare', () => {
    const receiver = resolveReceiver(
      handler.getPropertyOrThrow('client').getNameNode(),
      handler,
      di,
    );
    expect(receiver.external).toEqual({ package: '@lib/kit', typeName: 'Client' });
  });
});

describe('finding a method', () => {
  it('looks through the classes a class extends', () => {
    expect(findMethod(handler, 'shared').method?.getName()).toBe('shared');
  });

  it('says which package a method came from when it came from one', () => {
    const client = file.getClassOrThrow('Handler').getPropertyOrThrow('client');
    const declaration = client.getType().getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) throw new Error('fixture class missing');
    expect(findMethod(declaration as ClassDeclaration, 'send').externalPackage).toBe('@lib/kit');
  });

  it('answers with nothing for a method that is not declared anywhere', () => {
    expect(findMethod(handler, 'missing')).toEqual({});
  });
});
