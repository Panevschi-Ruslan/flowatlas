import { parseConfig } from '@flowatlas/core';
import { Project, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { isResolved, resolveChannelName } from './channel-name.js';

const SHARED = `export const EVENTS = { orderShipped: 'order.shipped' } as const;
export declare const ORDER_CHANNELS: readonly ['order.created', 'order.paid'];`;

const SOURCE = `
import { EVENTS, ORDER_CHANNELS } from '@project/events';
const LOCAL_CHANNELS = ['a.one', 'a.two'] as const;
const WIDE_CHANNELS = ['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12','c13'] as const;
type WideVerb = 'v1'|'v2'|'v3'|'v4'|'v5'|'v6'|'v7';
const MIXED_CHANNELS = ['a.one', { nope: true }] as const;

export enum Topics { OrderPaid = 'order.paid' }
const ORDER_CREATED = 'order.created';
let mutable = 'nope';
declare function lookup(x: string): string;
type Verb = 'opened' | 'closed';
declare const registry: { verbFor(x: string): Verb };

export class Publisher {
  constructor(private readonly config: { get(key: string): string }) {}

  literal() { return 'order.created' }
  fromConst() { return ORDER_CREATED }
  fromEnum() { return Topics.OrderPaid }
  fromShared() { return EVENTS.orderShipped }
  // R40 — an array const from a shared package carries its values in the type.
  fromSharedList() { return ORDER_CHANNELS }
  fromLocalList() { return LOCAL_CHANNELS }
  fromMixedList() { return MIXED_CHANNELS }
  fromBuiltList() { return ['a.one'].concat(['a.two']) }
  fromConfig() { return this.config.get('ORDER_TOPIC') }
  fromTemplate(id: string) { return \`order:\${id}:created\` }
  allHoles(a: string, b: string) { return \`\${a}\${b}\` }
  objectPattern() { return { cmd: 'sum' } }

  // R42 — a hole computed from a closed set of strings is not a hole.
  folded(id: string, type: 'TICKET_OPENED' | 'TICKET_ON_HOLD' | 'TICKET_CLOSED') {
    const verb = type.slice('TICKET_'.length).toLowerCase().replace(/_/g, '-');
    return \`ticket:\${id}:\${verb}\`;
  }
  foldedDirect(id: string, kind: 'a' | 'b') { return \`x:\${id}:\${kind}\` }
  reassigned(id: string) {
    let verb = 'split';
    if (lookup('x') === 'y') verb = 'closed';
    return \`session:\${id}:\${verb}\`;
  }
  unfoldable(id: string, type: 'TICKET_OPENED' | 'TICKET_CLOSED') {
    const verb = lookup(type);
    return \`ticket:\${id}:\${verb}\`;
  }
  // The same fact stated in the type instead of in a comment, which is what a
  // reader should reach for first: checked, renamed with its members, and
  // unable to drift from the code because it is the code. It has to read the
  // same wherever the value is written.
  typedLocal(id: string, type: string) {
    const verb: Verb = registry.verbFor(type);
    return \`ticket:\${id}:\${verb}\`;
  }
  typedInline(id: string, type: string) {
    return \`ticket:\${id}:\${registry.verbFor(type)}\`;
  }
  // More combinations than the cap: the address goes back to being a pattern
  // rather than keeping whichever prefix happened to be first (R42 review).
  tooMany(a: 'x' | 'y', b: WideVerb) { return \`\${a}.\${b}.v1\` }
  // A catalogue wider than the cap is a list nobody can use, not an object.
  wideList() { return WIDE_CHANNELS }
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

  /** The returned expression, for a method whose body has more than one statement. */
  const ofReturn = (methodName: string) => {
    const method = file.getClassOrThrow('Publisher').getMethodOrThrow(methodName);
    const returned = method
      .getBodyOrThrow()
      .getDescendantStatements()
      .find((statement) => statement.getKindName() === 'ReturnStatement');
    const expression = returned
      ?.getChildren()
      .find((child) => child.getKindName() !== 'ReturnKeyword' && child.getKindName() !== 'SemicolonToken');
    if (expression === undefined) throw new Error(`no return in ${methodName}`);
    return resolveChannelName(expression, config);
  };

  describe('a list of channels (R40)', () => {
    it('reads an array const out of a shared package, where only the type has the values', () => {
      const resolved = of('fromSharedList');
      expect(isResolved(resolved) && resolved.names).toEqual(['order.created', 'order.paid']);
    });

    it('reads a local `as const` array the same way', () => {
      const resolved = of('fromLocalList');
      expect(isResolved(resolved) && resolved.names).toEqual(['a.one', 'a.two']);
    });

    it('an array with a non-string member is not half-read', () => {
      const resolved = of('fromMixedList');
      expect(isResolved(resolved) && resolved.names).not.toEqual(['a.one']);
    });

    it('an array built by a call is not a list of names', () => {
      const resolved = of('fromBuiltList');
      expect(isResolved(resolved) && resolved.names).not.toEqual(['a.one', 'a.two']);
    });
  });

  describe('a hole whose values are knowable (R42)', () => {
    it('folds pure string operations over a literal union', () => {
      const resolved = ofReturn('folded');
      expect(isResolved(resolved) && resolved.names).toEqual([
        'ticket:*:closed',
        'ticket:*:on-hold',
        'ticket:*:opened',
      ]);
    });

    it('keeps the wildcard pattern as the representative name', () => {
      const resolved = ofReturn('folded');
      expect(isResolved(resolved) && resolved.name).toBe('ticket:*:*');
    });

    it('expands a hole typed as a union directly, with no computation', () => {
      const resolved = of('foldedDirect');
      expect(isResolved(resolved) && resolved.names).toEqual(['x:*:a', 'x:*:b']);
    });

    it('a reassigned `let` is a hole, not its first value', () => {
      // Following a `let`'s initializer would assert `session:*:split` and
      // silently omit `session:*:closed` — a confident wrong answer, which is
      // worse than the wildcard it replaces.
      const resolved = ofReturn('reassigned');
      expect(isResolved(resolved) && resolved.names).toEqual(['session:*:*']);
    });

    it('an unsupported operation still wildcards — the closed set stays closed', () => {
      const resolved = ofReturn('unfoldable');
      expect(isResolved(resolved) && resolved.names).toEqual(['ticket:*:*']);
    });

    it('goes back to a pattern when there are more names than the cap', () => {
      // Keeping the first prefix asserted one family and hid the others: an
      // edge to `x.*.v1` for an address that reaches `y.*.v1` too.
      const resolved = ofReturn('tooMany');
      expect(isResolved(resolved) && resolved.names).toEqual(['*.*.v1']);
      expect(isResolved(resolved) && resolved.name).toBe('*.*.v1');
    });

    it('refuses a catalogue wider than the cap rather than naming a channel after it', () => {
      // It used to fall through to the object branch and write the whole array
      // out as one channel's name.
      expect(ofReturn('wideList')).toEqual({ unresolved: 'channel-dynamic', text: 'WIDE_CHANNELS' });
    });

    it('reads a union the type states, wherever the value is written', () => {
      // The annotation is the last resort, not the first: a value the type
      // already pins down needs nothing written about it, and it must not
      // matter whether it was parked in a local on the way (R42).
      for (const method of ['typedLocal', 'typedInline']) {
        const resolved = ofReturn(method);
        expect(isResolved(resolved) && resolved.names, method).toEqual([
          'ticket:*:closed',
          'ticket:*:opened',
        ]);
      }
    });
  });

  it('reads a string literal', () => {
    expect(of('literal')).toEqual({ name: 'order.created', names: ['order.created'], via: 'literal' });
  });

  it('follows a constant declared here', () => {
    expect(of('fromConst')).toEqual({ name: 'order.created', names: ['order.created'], via: 'const' });
  });

  it('follows an enum member', () => {
    expect(of('fromEnum')).toEqual({ name: 'order.paid', names: ['order.paid'], via: 'enum' });
  });

  it('follows a constant shared between services', () => {
    expect(of('fromShared')).toEqual({ name: 'order.shipped', names: ['order.shipped'], via: 'shared-package' });
  });

  it('keeps the family of a channel addressed per entity', () => {
    expect(of('fromTemplate')).toEqual({ name: 'order:*:created', names: ['order:*:created'], via: 'template' });
  });

  it('refuses a template that names nothing at all', () => {
    const result = of('allHoles');
    expect(isResolved(result)).toBe(false);
  });

  it('turns an object pattern into a stable name', () => {
    expect(of('objectPattern')).toEqual({ name: '{"cmd":"sum"}', names: ['{"cmd":"sum"}'], via: 'pattern' });
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
