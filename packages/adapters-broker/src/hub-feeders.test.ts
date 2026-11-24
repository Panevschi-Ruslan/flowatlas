import { Node, Project, SyntaxKind, type CallExpression, type Node as TsNode } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { channelsFrom, channelTestOf, fedChannels, fedFrom, keyTestOf, type FeedLookup } from './hub-feeders.js';

/**
 * The channels a hub is handed by name through the project's own publish
 * helper (P362): followed out from the write to the hub's stub, through the
 * parameters each function hands on, to the calls that name a channel, with
 * the tests of the channel on the way.
 */
const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
let count = 0;

const lookupOf = (text: string): { write: CallExpression; lookup: FeedLookup } => {
  const file = project.createSourceFile(`feed-${(count += 1)}.ts`, text);
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
  const write = calls.find((call) => call.getText().startsWith('stub.fetch')) as CallExpression;
  const nameOf = (fn: TsNode): string => {
    if (Node.isMethodDeclaration(fn)) return `${fn.getParentOrThrow().asKindOrThrow(SyntaxKind.ClassDeclaration).getName()}.${fn.getName()}`;
    if (Node.isFunctionDeclaration(fn)) return fn.getName() ?? '?';
    return (fn.getParent() as { getName?: () => string }).getName?.() ?? '?';
  };
  const lookup: FeedLookup = {
    callsOf: (fn) =>
      calls.filter((call) => {
        const callee = call.getExpression();
        const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
        const declaration = name.getSymbol()?.getDeclarations()[0];
        const held = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
        return held === fn;
      }).map((call) => ({ call })),
    named: (argument) => {
      const at = argument;
      if (Node.isStringLiteral(at)) return [at.getLiteralText()];
      if (Node.isTemplateExpression(at)) return [[at.getHead().getLiteralText(), ...at.getTemplateSpans().map((span) => `*${span.getLiteral().getLiteralText()}`)].join('')];
      return undefined;
    },
    nameOf,
    fileOf: () => 'bus.ts',
  };
  return { write, lookup };
};

const read = (text: string) => {
  const { write, lookup } = lookupOf(text);
  return fedChannels(write, lookup).map((each) => `${each.channel} ${each.confidence} ${each.through.join(' > ')}`);
};

describe('the channels a write to a hub hands on (P362)', () => {
  it('follows the channel a helper is handed, through a method of its own, to every call that names one', () => {
    expect(
      read(`
      declare const stub: { fetch(url: string, init?: unknown): Promise<unknown> };
      const FAMILIES: readonly string[] = ['board:'];
      export class Bus {
        async publish(channel: string, message: unknown) {
          if (FAMILIES.some((family) => channel.startsWith(family))) await this.toHub(channel, message);
        }
        private async toHub(channel: string, message: unknown) {
          await stub.fetch('https://hub/publish', { method: 'POST', body: JSON.stringify({ channel, message }) });
        }
      }
      export class Boards {
        constructor(private readonly bus: Bus) {}
        moved(id: string) { return this.bus.publish(\`board:\${id}:events\`, { type: 'MOVED' }); }
        assigned(id: string) { return this.bus.publish(\`crew:\${id}:shifts\`, { type: 'ASSIGNED' }); }
      }`),
    ).toEqual(['board:*:events static Bus.publish > Bus.toHub']);
  });

  it('keeps a channel a test may let through as a guess, and drops one an early return rules out', () => {
    expect(
      read(`
      declare const stub: { fetch(url: string, init?: unknown): Promise<unknown> };
      declare function allowed(channel: string): boolean;
      export function toHub(channel: string, message: unknown) {
        if (channel.endsWith(':audit')) return;
        if (allowed(channel)) void stub.fetch('https://hub/publish', { body: JSON.stringify({ channel, message }) });
      }
      export function a() { toHub('board:1:events', {}); }
      export function b() { toHub('board:1:audit', {}); }`),
    ).toEqual(['board:1:events heuristic toHub']);
  });

  it('hands on nothing where the write is handed no parameter', () => {
    expect(
      read(`
      declare const stub: { fetch(url: string, init?: unknown): Promise<unknown> };
      export function ping(channel: string) { void stub.fetch('https://hub/ping'); }
      export function a() { ping('board:1:events'); }`),
    ).toEqual([]);
  });
});

describe('a write to a hub whose channel is worked out when the code runs (P395)', () => {
  it('counts the values on the way out that no reading names, beside the channels it does', () => {
    const { write, lookup } = lookupOf(`
      declare const stub: { fetch(url: string, init?: unknown): Promise<unknown> };
      declare function channelFromSettings(id: string): string;
      export function toHub(channel: string, message: unknown) {
        void stub.fetch('https://hub/publish', { body: JSON.stringify({ channel, message }) });
      }
      export function named(id: string) { toHub(\`board:\${id}:events\`, {}); }
      export function looked(id: string) { toHub(channelFromSettings(id), {}); }`);
    const fed = fedFrom(write, lookup);
    expect(fed.channels.map((each) => each.channel)).toEqual(['board:*:events']);
    expect(fed.unread).toBe(1);
  });
});

describe('a test of a channel', () => {
  const testOf = (condition: string) => {
    const file = project.createSourceFile(`test-${(count += 1)}.ts`, `declare const channel: string; const LIST = ['a:', 'b:'] as const;\nconst x = ${condition};`);
    const written = file.getVariableDeclarationOrThrow('x').getInitializerOrThrow();
    const test = channelTestOf(written, (node) => Node.isIdentifier(node) && node.getText() === 'channel');
    return test === undefined ? undefined : (name: string) => test(name);
  };

  it('reads a method of the string, a comparison, a pattern and a list, and says maybe through a placeholder', () => {
    expect(testOf(`channel.startsWith('board:')`)?.('board:*:events')).toBe('yes');
    expect(testOf(`channel.startsWith('board:1')`)?.('board:*:events')).toBe('maybe');
    expect(testOf(`channel.startsWith('crew:')`)?.('board:*:events')).toBe('no');
    expect(testOf(`channel === 'board:1:events'`)?.('board:*:events')).toBe('maybe');
    expect(testOf(`!channel.includes(':events')`)?.('board:*:events')).toBe('no');
    expect(testOf(`/^board:/.test(channel)`)?.('board:1:events')).toBe('yes');
    expect(testOf(`LIST.includes(channel)`)?.('a:')).toBe('yes');
    expect(testOf(`LIST.some((p) => channel.startsWith(p))`)?.('b:x')).toBe('yes');
    expect(testOf(`LIST.some((p) => channel.startsWith(p))`)?.('c:x')).toBe('no');
  });

  it('says nothing of a condition that does not read the channel', () => {
    expect(testOf(`Math.random() > 0.5`)).toBeUndefined();
  });
});

describe('a call through a record of handlers by a key the channel decides', () => {
  const keyTest = (text: string, member: string) => {
    const file = project.createSourceFile(`key-${(count += 1)}.ts`, text);
    const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => /handlers\[/.test(each.getExpression().getText())) as CallExpression;
    return keyTestOf(call, member);
  };
  const ROUTED = `
    type Transport = 'hub' | 'worker';
    const HUB_ONLY: ReadonlySet<Transport> = new Set<Transport>(['hub']);
    const WORKER_ONLY: ReadonlySet<Transport> = new Set<Transport>(['worker']);
    const BOTH = new Set<Transport>(['hub', 'worker']);
    const ROUTES: ReadonlyMap<string, ReadonlySet<Transport>> = new Map([
      ['board:{boardId}:events', HUB_ONLY],
      ['crew:*:shifts', BOTH],
      ['status_updates', WORKER_ONLY],
    ]);
    const familyOf = (channel: string): string => channel.replace(/:[^:]+:/, ':*:');
    const resolveTransports = (channel: string): ReadonlySet<Transport> => ROUTES.get(familyOf(channel)) ?? DEFAULT;
    declare const handlers: Record<Transport, (channel: string) => void>;
  `;

  it('reads the keys the routing table gives a channel, and the default where it has none', () => {
    const test = keyTest(
      `${ROUTED}
      const DEFAULT = HUB_ONLY;
      export function publish(channel: string) {
        const transports = [...resolveTransports(channel)];
        transports.map((t) => handlers[t](channel));
      }`,
      'hub',
    );
    expect(test('board:*:events')).toBe('yes');
    expect(test('crew:*:shifts')).toBe('yes');
    expect(test('status_updates')).toBe('no');
    expect(test('audit:*:log')).toBe('maybe');
  });

  it('reads a for-of over the routed keys, and a default that leaves the member out', () => {
    const test = keyTest(
      `${ROUTED}
      const DEFAULT = WORKER_ONLY;
      export function publish(channel: string) {
        for (const t of Array.from(resolveTransports(channel))) handlers[t](channel);
      }`,
      'hub',
    );
    expect(test('board:*:events')).toBe('yes');
    expect(test('audit:*:log')).toBe('no');
  });

  it('says maybe for every channel where the key is not drawn from a table read', () => {
    const test = keyTest(
      `declare const handlers: Record<string, (channel: string) => void>;
      declare function pick(channel: string): string;
      export function publish(channel: string) { handlers[pick(channel)](channel); }`,
      'hub',
    );
    expect(test('board:*:events')).toBe('maybe');
  });
});

describe('only the value the hub reads as the channel is followed (P362)', () => {
  it('reads a channel worked out inside a helper that takes the type first, and never the type or an object for one', () => {
    expect(
      read(`
      declare const stub: { fetch(url: string, init?: unknown): Promise<unknown> };
      export class Bus {
        async publish(channel: string, message: unknown) {
          await stub.fetch('https://hub/publish', { method: 'POST', body: JSON.stringify({ channel, message }) });
        }
      }
      export class Cards {
        constructor(private readonly bus: Bus) {}
        async publishCardEvent(type: string, boardId: string, extra: Record<string, unknown>) {
          const channel = \`board:\${boardId}:events\`;
          await this.bus.publish(channel, { type, ...extra });
        }
        async relay(event: { source: string; type: string }, boardId: string) {
          await this.bus.publish(\`board:\${boardId}:audit\`, event);
        }
        pin(boardId: string) { return this.publishCardEvent('CARD_PINNED', boardId, {}); }
        imported(boardId: string) { return this.relay({ source: 'import', type: 'CARD_IMPORTED' }, boardId); }
      }`),
    ).toEqual(['board:*:audit static Bus.publish', 'board:*:events static Bus.publish']);
  });

  it('follows no parameter that is also written as the type, nor a name shaped like a type', () => {
    expect(
      read(`
      declare const stub: { fetch(url: string, init?: unknown): Promise<unknown> };
      export function toHub(channel: string) {
        void stub.fetch('https://hub/publish', { body: JSON.stringify({ channel, message: { type: channel } }) });
      }
      export function send(channel: string) { void stub.fetch('https://hub/publish', { body: JSON.stringify({ channel }) }); }
      export function a() { toHub('board:1:events'); send('CARD_PINNED'); }`),
    ).toEqual([]);
  });
});

describe('a call to a helper that names the channel is a publish of it (P362)', () => {
  it('names each call that hands the helper a channel, with the argument the message is in, from a method marked as a transport', () => {
    const file = project.createSourceFile(
      `helper-${(count += 1)}.ts`,
      `
      export class Bus {
        async publish(channel: string, message: unknown) { await this.toWorker(channel, message); }
        private async toWorker(channel: string, message: unknown) { void message; }
      }
      export class Orders {
        constructor(private readonly bus: Bus) {}
        alert(id: string) { return this.bus.publish(\`board:\${id}:orders\`, { type: 'SCHEDULED_ALERT', id }); }
      }`,
    );
    const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression);
    const lookup: FeedLookup = {
      callsOf: (fn) =>
        calls
          .filter((call) => {
            const callee = call.getExpression();
            const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
            return name.getSymbol()?.getDeclarations()[0] === fn;
          })
          .map((call) => ({ call })),
      named: (argument) =>
        Node.isTemplateExpression(argument) ? [[argument.getHead().getLiteralText(), ...argument.getTemplateSpans().map((span) => `*${span.getLiteral().getLiteralText()}`)].join('')] : undefined,
      nameOf: (fn) => (Node.isMethodDeclaration(fn) ? `${fn.getParentOrThrow().asKindOrThrow(SyntaxKind.ClassDeclaration).getName()}.${fn.getName()}` : '?'),
      fileOf: () => 'orders.ts',
    };
    const transport = file.getClassOrThrow('Bus').getMethodOrThrow('toWorker').getParameters()[0]!.getNameNode();
    const fed = channelsFrom(transport, transport, lookup);
    expect(fed.channels.map((each) => each.channel)).toEqual(['board:*:orders']);
    expect(fed.publishes.map((each) => `${each.helper} ${each.channels.join(',')} ${each.confidence} ${each.payload?.getText()}`)).toEqual([
      "Bus.publish board:*:orders static { type: 'SCHEDULED_ALERT', id }",
    ]);
  });
});
