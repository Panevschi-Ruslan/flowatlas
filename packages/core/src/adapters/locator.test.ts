import {
  Project,
  SyntaxKind,
  type CallExpression,
  type ClassDeclaration,
  type Decorator,
  type SourceFile,
} from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { locatedExpressions, type NameLocator } from './locator.js';

/**
 * The kinds that could not be exercised from the data-layer side.
 *
 * `argument`, the chain walks and `receiver` are covered by the table locator's
 * own suite against the shapes four real query builders are written in. What is
 * tested here is the vocabulary the channel side needed and the one place both
 * halves meet: a locator reading a decorator rather than a call.
 */
const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);

const callTo = (file: SourceFile, method: string): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith(`.${method}`));
  if (call === undefined) throw new Error(`no .${method}() in the source`);
  return call;
};

const classNamed = (file: SourceFile, name: string): ClassDeclaration => {
  const declaration = file.getClass(name);
  if (declaration === undefined) throw new Error(`no class ${name}`);
  return declaration;
};

const decoratorOn = (declaration: ClassDeclaration, name: string): Decorator => {
  const decorator = declaration.getDecorator(name);
  if (decorator === undefined) throw new Error(`no @${name}`);
  return decorator;
};

const texts = (
  site: Parameters<typeof locatedExpressions>[0],
  locators: readonly NameLocator[],
  context: Parameters<typeof locatedExpressions>[2] = {},
): string[] => locatedExpressions(site, locators, context).map((node) => node.getText());

describe('a name written as a property of an object argument', () => {
  const NAME: readonly NameLocator[] = [{ kind: 'argument-property', index: 0, key: 'name' }];

  it('reads a property written out', () => {
    const file = parse(`const bus = { queue(item: unknown) {} };
bus.queue({ name: 'thumbnail.generate', data: {} });`);
    expect(texts(callTo(file, 'queue'), NAME)).toEqual(["'thumbnail.generate'"]);
  });

  it('reads a shorthand property as the identifier it stands for', () => {
    const file = parse(`const bus = { queue(item: unknown) {} };
const name = 'mail.send';
bus.queue({ name, data: {} });`);
    expect(texts(callTo(file, 'queue'), NAME)).toEqual(['name']);
  });

  it('points at nothing when the argument is not an object at all', () => {
    const file = parse(`const bus = { queue(item: unknown) {} };
bus.queue('mail.send');`);
    expect(texts(callTo(file, 'queue'), NAME)).toEqual([]);
  });

  it('points at nothing when the object has no such property', () => {
    const file = parse(`const bus = { queue(item: unknown) {} };
bus.queue({ topic: 'mail.send' });`);
    expect(texts(callTo(file, 'queue'), NAME)).toEqual([]);
  });

  /**
   * The order a description lists its locators in is the description's to decide,
   * and this is why it matters: a list that asked for the plain argument first
   * would be answered by the options object itself, which on the channel side is
   * a legal address and therefore succeeds with the wrong name.
   */
  it('keeps the order the locators were listed in', () => {
    const file = parse(`const bus = { queue(item: unknown) {} };
bus.queue({ name: 'mail.send' });`);
    expect(
      texts(callTo(file, 'queue'), [...NAME, { kind: 'argument', index: 0 }]),
    ).toEqual(["'mail.send'", "{ name: 'mail.send' }"]);
  });
});

describe('a name the receiver’s own class states', () => {
  const SUPER: readonly NameLocator[] = [{ kind: 'base-constructor-argument', index: 0 }];

  const source = `class QueueBase { constructor(topic: string) {} push(p: unknown) {} }
class MailQueue extends QueueBase { constructor() { super('mail.send'); } }
class LoudMailQueue extends MailQueue {}
class Bare { push(p: unknown) {} }
declare const mail: MailQueue;
mail.push({});`;

  it('reads the argument the class hands to its base', () => {
    const file = parse(source);
    const call = callTo(file, 'push');
    expect(texts(call, SUPER, { typeDeclaration: classNamed(file, 'MailQueue') })).toEqual([
      "'mail.send'",
    ]);
  });

  it('reads it from the base when the class declares no constructor of its own', () => {
    const file = parse(source);
    const call = callTo(file, 'push');
    expect(texts(call, SUPER, { typeDeclaration: classNamed(file, 'LoudMailQueue') })).toEqual([
      "'mail.send'",
    ]);
  });

  it('points at nothing when there is no base constructor call', () => {
    const file = parse(source);
    expect(texts(callTo(file, 'push'), SUPER, { typeDeclaration: classNamed(file, 'Bare') })).toEqual(
      [],
    );
  });

  it('points at nothing when the caller resolved no type', () => {
    const file = parse(source);
    expect(texts(callTo(file, 'push'), SUPER)).toEqual([]);
  });
});

describe('a name written on whatever provided the receiver', () => {
  const INJECTED: readonly NameLocator[] = [
    { kind: 'provider-decorator', decorator: 'InjectQueue', index: 0 },
  ];

  const source = `declare function InjectQueue(name?: string): ParameterDecorator;
declare class Queue { add(name: string, data: unknown): void }
class Mailer {
  constructor(@InjectQueue('mail') private readonly queue: Queue) {}
  send() { this.queue.add('send-email', {}); }
}`;

  it('reads the argument of the decorator on the parameter', () => {
    const file = parse(source);
    const parameter = classNamed(file, 'Mailer').getConstructors()[0]?.getParameters()[0];
    expect(texts(callTo(file, 'add'), INJECTED, { providerDeclaration: parameter })).toEqual([
      "'mail'",
    ]);
  });

  it('points at nothing when nothing provided the receiver', () => {
    const file = parse(source);
    expect(texts(callTo(file, 'add'), INJECTED)).toEqual([]);
  });
});

describe('a decorator read as a site of its own', () => {
  const source = `declare function OnJob(config: unknown): MethodDecorator;
declare function Processor(queue?: unknown): ClassDecorator;
@Processor({ name: 'reports' })
class Reports {
  @OnJob({ name: 'thumbnail.generate' })
  handle() {}
}`;

  /**
   * The reason a decorator is a site at all: the name is in the same place it
   * would be in a call, so describing a handler and describing a publish is one
   * vocabulary rather than two.
   */
  it('reads a property of the decorator’s options object', () => {
    const file = parse(source);
    const decorator = decoratorOn(classNamed(file, 'Reports'), 'Processor');
    expect(texts(decorator, [{ kind: 'argument-property', index: 0, key: 'name' }])).toEqual([
      "'reports'",
    ]);
  });

  it('gives nothing for the kinds only a call can answer', () => {
    const file = parse(source);
    const decorator = decoratorOn(classNamed(file, 'Reports'), 'Processor');
    expect(
      texts(decorator, [
        { kind: 'receiver' },
        { kind: 'chain-call', method: 'from', index: 0 },
        { kind: 'chain-root-argument', index: 0 },
      ]),
    ).toEqual([]);
  });
});

describe('a name a property of the receiver’s class is set to (R165)', () => {
  const TABLE: readonly NameLocator[] = [{ kind: 'receiver-type-property', key: 'collectionName' }];
  const file = parse(`
    const ORDERS = 'orders';
    abstract class Base { protected abstract readonly collectionName: string; find() {} }
    class Orders extends Base { protected readonly collectionName = ORDERS; }
    class Middle extends Base { protected readonly collectionName = 'middle'; }
    class Leaf extends Middle {}
    class Bare extends Base {}
    new Orders().find();
  `);
  const site = callTo(file, 'find');

  it('reads what the class itself sets the property to', () => {
    expect(texts(site, TABLE, { typeDeclaration: classNamed(file, 'Orders') })).toEqual(['ORDERS']);
  });

  it('reads it from a base the class extends when the class sets nothing', () => {
    expect(texts(site, TABLE, { typeDeclaration: classNamed(file, 'Leaf') })).toEqual(["'middle'"]);
  });

  it('points at nothing when only the abstract declaration exists', () => {
    expect(texts(site, TABLE, { typeDeclaration: classNamed(file, 'Bare') })).toEqual([]);
  });
});

describe('a chain continued through a constant (R165)', () => {
  const COLLECTION: readonly NameLocator[] = [{ kind: 'chain-call', method: 'collection', index: 0 }];

  it('reads the call a constant was bound to as a link of the chain', () => {
    const file = parse(`const users = db.collection('users'); users.updateMany({}, {});`);
    expect(texts(callTo(file, 'updateMany'), COLLECTION)).toEqual(["'users'"]);
  });

  it('does not follow a binding that can be reassigned', () => {
    const file = parse(`let users = db.collection('users'); users.updateMany({}, {});`);
    expect(texts(callTo(file, 'updateMany'), COLLECTION)).toEqual([]);
  });

  it('does not follow a binding that states its own type', () => {
    const file = parse(`const users: Store = db.collection('users'); users.updateMany({}, {});`);
    expect(texts(callTo(file, 'updateMany'), COLLECTION)).toEqual([]);
  });
});
