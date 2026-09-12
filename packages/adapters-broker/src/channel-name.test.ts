import { parseConfig } from '@flowatlas/core';
import { Project, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { isResolved, resolveChannelName } from './channel-name.js';

const SHARED = `export const EVENTS = { orderShipped: 'order.shipped' } as const;`;

const SOURCE = `
import { EVENTS } from '@project/events';

export enum Topics { OrderPaid = 'order.paid' }
const ORDER_CREATED = 'order.created';
let mutable = 'nope';

export class Publisher {
  constructor(private readonly config: { get(key: string): string }) {}

  literal() { return 'order.created' }
  fromConst() { return ORDER_CREATED }
  fromEnum() { return Topics.OrderPaid }
  fromShared() { return EVENTS.orderShipped }
  fromConfig() { return this.config.get('ORDER_TOPIC') }
  fromTemplate(id: string) { return \`order:\${id}:created\` }
  allHoles(a: string, b: string) { return \`\${a}\${b}\` }
  objectPattern() { return { cmd: 'sum' } }
  fromVariable() { return mutable }
  computed(a: string) { return a.toUpperCase() }
}
`;

const config = parseConfig({ sharedPackages: ['@project/events'] });

describe('resolving which channel a call addresses', () => {
  let file: SourceFile;

  beforeAll(() => {
    const project = new Project({ useInMemoryFileSystem: true });
    // Package identity comes from the nearest manifest, so the fixture needs one.
    project.createSourceFile(
      'node_modules/@project/events/package.json',
      JSON.stringify({ name: '@project/events', version: '1.0.0', types: 'index.d.ts' }),
    );
    project.createSourceFile('node_modules/@project/events/index.d.ts', SHARED);
    file = project.createSourceFile('publisher.ts', SOURCE);
  });

  const of = (methodName: string) => {
    const method = file.getClassOrThrow('Publisher').getMethodOrThrow(methodName);
    const statement = method.getBodyOrThrow().getDescendantStatements()[0];
    const expression = statement?.getChildren().find((child) => child.getKindName() !== 'ReturnKeyword');
    if (expression === undefined) throw new Error(`no expression in ${methodName}`);
    return resolveChannelName(expression, config);
  };

  it('reads a string literal', () => {
    expect(of('literal')).toEqual({ name: 'order.created', via: 'literal' });
  });

  it('follows a constant declared here', () => {
    expect(of('fromConst')).toEqual({ name: 'order.created', via: 'const' });
  });

  it('follows an enum member', () => {
    expect(of('fromEnum')).toEqual({ name: 'order.paid', via: 'enum' });
  });

  it('follows a constant shared between services', () => {
    expect(of('fromShared')).toEqual({ name: 'order.shipped', via: 'shared-package' });
  });

  it('keeps the family of a channel addressed per entity', () => {
    expect(of('fromTemplate')).toEqual({ name: 'order:*:created', via: 'template' });
  });

  it('refuses a template that names nothing at all', () => {
    const result = of('allHoles');
    expect(isResolved(result)).toBe(false);
  });

  it('turns an object pattern into a stable name', () => {
    expect(of('objectPattern')).toEqual({ name: '{"cmd":"sum"}', via: 'pattern' });
  });

  it('will not guess a channel read from settings, and says which it was', () => {
    const result = of('fromConfig');
    expect(isResolved(result)).toBe(false);
    if (!isResolved(result)) expect(result.unresolved).toBe('channel-from-config');
  });

  it('tells an unfollowable name apart from an expression that was never constant', () => {
    const named = of('fromVariable');
    const computed = of('computed');
    if (!isResolved(named)) expect(named.unresolved).toBe('channel-const-unresolved');
    if (!isResolved(computed)) expect(computed.unresolved).toBe('channel-dynamic');
  });
});
