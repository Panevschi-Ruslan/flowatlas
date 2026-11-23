import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { GraphBuilder, selectionsOf, SUBSCRIPTIONS_META, type ClassMethod, type Unresolved } from '@flowatlas/core';
import { parameterSelection, readMessageTypes, type MessageTypeHost } from './message-type.js';

/**
 * The types a handler takes where its body chooses none (P369): said by the
 * declared type of its parameter, by the code calling it under a choice, by a
 * function written in place where it subscribes, or by the function it hands
 * the message on to.
 */
const EVENTS = `
export interface Ready { type: 'READY'; id: string }
export interface Cancelled { type: 'CANCELLED'; id: string }
export interface Either { type: 'READY' | 'CANCELLED'; id: string }
export interface Plain { type: string; id: string }
export type Any = Ready | Cancelled;
`;

const HANDLERS = `
import type { Any, Cancelled, Either, Plain, Ready } from './events';

export class Handlers {
  ready(event: Ready): string { return event.id; }
  status(event: Plain): string { return event.id; }
  refund(event: Cancelled): string { return event.id; }
  either(event: Either): string { return event.id; }
  all(event: Any): string { return event.id; }
  loose(event: Plain): string { return event.id; }
}
`;

const ROUTER = `
import type { Cancelled, Plain, Ready } from './events';
import { Handlers } from './handlers';

export class Router {
  constructor(private readonly handlers: Handlers) {}

  route(path: string, body: { message: Plain }): string {
    const event = body.message;
    this.handlers.loose(event);
    switch (event.type) {
      case 'READY':
        return this.handlers.ready(event as Ready);
      case 'SHIPPED':
      case 'CANCELLED':
        return this.handlers.status(event);
      case 'REFUNDED':
        return this.handlers.refund(event as unknown as Cancelled);
      default:
        return path;
    }
  }
}
`;

const WATCHERS = `
declare class Stream<T> { subscribe(next: (value: T) => void): void }
declare class Bus { all(): Stream<{ scope: string; data: unknown }>; on(channel: string, handler: (data: unknown) => void): void }
interface Evt { type: string; id?: string }

export class Notify {
  private static readonly RELEVANT = new Set(['HELP', 'READY']);
  constructor(private readonly bus: Bus) {}

  start(): void {
    this.bus.all().subscribe(({ scope, data }) => {
      const evt = data as Evt;
      if (!evt || !evt.type) return;
      if (!Notify.RELEVANT.has(evt.type)) return;
      this.dispatch(scope, data);
    });
  }

  dispatch(scope: string, raw: unknown): void {
    const evt = raw as Evt;
    switch (evt.type) {
      case 'HELP':
        this.page(scope, evt);
        return;
      case 'READY':
        this.ping(scope, evt);
        return;
    }
  }

  page(scope: string, evt: Evt): void { void scope; void evt; }
  ping(scope: string, evt: Evt): void { void scope; void evt; }
}

export class Counter {
  private seen = 0;
  constructor(private readonly bus: Bus) {}

  start(): void {
    this.bus.all().subscribe(({ scope, data }) => this.count(scope, data));
  }

  count(scope: string, raw: unknown): void {
    const evt = raw as Evt;
    if (evt.type === 'PLACED') this.seen += scope.length;
  }
}

export class Closer {
  constructor(private readonly bus: Bus) {}

  start(): void {
    this.bus.on('desks', (data) => {
      const evt = data as Evt;
      if (evt.type === 'CLOSED') {
        this.archive(evt.id);
        this.log('closed');
      }
    });
  }

  archive(id: string | undefined): void { void id; }
  log(line: string): void { void line; }
}
`;

const REPO = 'app';

const setup = () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  project.createSourceFile('/app/events.ts', EVENTS);
  project.createSourceFile('/app/handlers.ts', HANDLERS);
  project.createSourceFile('/app/router.ts', ROUTER);
  project.createSourceFile('/app/watchers.ts', WATCHERS);
  const builder = new GraphBuilder({ repo: REPO });
  const methodIdOf = (declaration: ClassMethod): string | undefined => {
    const owner = declaration.getParent();
    if (owner === undefined || !('getName' in owner)) return undefined;
    const file = declaration.getSourceFile().getFilePath().replace('/app/', '');
    return `${REPO}#${file}:${(owner as { getName(): string }).getName()}.${declaration.getName()}`;
  };
  const ensureMethodNode = (declaration: ClassMethod) => {
    const id = methodIdOf(declaration);
    if (id === undefined) return undefined;
    const file = declaration.getSourceFile().getFilePath().replace('/app/', '');
    return builder.getNode(id) ?? builder.addNode({ id, type: 'method', label: id.slice(id.lastIndexOf(':') + 1), repo: REPO, file, line: declaration.getStartLineNumber() });
  };
  for (const file of project.getSourceFiles()) for (const owner of file.getClasses()) for (const method of owner.getMethods()) ensureMethodNode(method);
  const rows: Unresolved[] = [];
  const host: MessageTypeHost = { repo: REPO, repoDir: '/app', project, builder, methodIdOf, ensureMethodNode, report: (row) => rows.push(row) };
  /** A consumer of `channel` whose handler is a method. */
  const consumerAt = (handler: string, line?: number): string => {
    const id = `consumer:${handler}`;
    const node = builder.getNode(handler)!;
    builder.addNode({ id: 'channel:orders', type: 'channel', label: 'orders', repo: REPO });
    builder.addNode({ id, type: 'consumer', label: node.label, repo: REPO, file: node.file!, line: line ?? node.line! });
    builder.addEdge({ from: id, to: handler, type: 'handles', confidence: 'static' });
    builder.addEdge({ from: 'channel:orders', to: id, type: 'consumes', confidence: 'static' });
    return id;
  };
  const callsAt = (from: string, to: string) => builder.addEdge({ from, to, type: 'calls', confidence: 'static' });
  return { project, builder, host, rows, consumerAt, callsAt };
};

const said = (builder: GraphBuilder, id: string): string[] =>
  selectionsOf(builder.getNode(id)).map((selection) => `${selection.type}:${selection.via}:${selection.consumer.slice(selection.consumer.lastIndexOf(':') + 1)}${selection.file === undefined ? '' : `@${selection.file}`}`);

describe('a handler that chooses no type in its body (P369)', () => {
  it('takes the literal its parameter declares, or the literals of a union there, and none from a union of messages or a string', () => {
    const { project } = setup();
    const owner = project.getSourceFileOrThrow('/app/handlers.ts').getClassOrThrow('Handlers');
    const of = (name: string) => parameterSelection(owner.getMethodOrThrow(name))?.values;
    expect(of('ready')).toEqual(['READY']);
    expect(of('either')).toEqual(['READY', 'CANCELLED']);
    expect(of('all')).toBeUndefined();
    expect(of('loose')).toBeUndefined();
  });

  it('is drawn for its parameter where nothing calls it under a choice', () => {
    const { builder, host, rows, consumerAt } = setup();
    const id = consumerAt('app#handlers.ts:Handlers.either');
    readMessageTypes(host);
    expect(said(builder, id)).toEqual(['CANCELLED:parameter:Handlers.either', 'READY:parameter:Handlers.either']);
    expect(rows).toEqual([]);
  });

  it('is drawn for the case its caller calls it under, with the caller\'s file, and the parameter agreeing says nothing', () => {
    const { builder, host, rows, consumerAt, callsAt } = setup();
    const ready = consumerAt('app#handlers.ts:Handlers.ready');
    const status = consumerAt('app#handlers.ts:Handlers.status');
    callsAt('app#router.ts:Router.route', 'app#handlers.ts:Handlers.ready');
    callsAt('app#router.ts:Router.route', 'app#handlers.ts:Handlers.status');
    readMessageTypes(host);
    expect(said(builder, ready)).toEqual(['READY:switch:Handlers.ready@router.ts']);
    expect(said(builder, status)).toEqual(['CANCELLED:switch:Handlers.status@router.ts', 'SHIPPED:switch:Handlers.status@router.ts']);
    expect(rows).toEqual([]);
  });

  it('draws the caller\'s choice where the parameter says another type, with a row', () => {
    const { builder, host, rows, consumerAt, callsAt } = setup();
    const refund = consumerAt('app#handlers.ts:Handlers.refund');
    callsAt('app#router.ts:Router.route', 'app#handlers.ts:Handlers.refund');
    readMessageTypes(host);
    expect(said(builder, refund)).toEqual(['REFUNDED:switch:Handlers.refund@router.ts']);
    expect(rows.map((row) => `${row.reason}:${row.level}`)).toEqual(['message-type-differs:info']);
    expect(rows[0]?.hint).toContain('says CANCELLED');
  });

  it('chooses nothing where its caller calls it outside any choice and its parameter says no one type', () => {
    const { builder, host, consumerAt, callsAt } = setup();
    const loose = consumerAt('app#handlers.ts:Handlers.loose');
    callsAt('app#router.ts:Router.route', 'app#handlers.ts:Handlers.loose');
    readMessageTypes(host);
    expect(said(builder, loose)).toEqual([]);
  });
});

describe('a subscription whose handler is written in place (P369)', () => {
  const subscribedAt = (builder: GraphBuilder, consumer: string, project: Project, file: string, start: (text: string) => boolean): void => {
    const at = project
      .getSourceFileOrThrow(file)
      .getDescendants()
      .find((node) => (node.getKind() === SyntaxKind.CallExpression || node.getKind() === SyntaxKind.ArrowFunction) && start(node.getText()))!;
    const { line, column } = project.getSourceFileOrThrow(file).getLineAndColumnAtPos(at.getStart());
    const node = builder.getNode(consumer)!;
    node.meta = { ...node.meta, [SUBSCRIPTIONS_META]: [{ line, column, through: 'Bus.all' }] };
  };

  it('follows a set gating the callback into the method it hands the message to, which chooses again', () => {
    const { project, builder, host, rows, consumerAt } = setup();
    const id = consumerAt('app#watchers.ts:Notify.start');
    subscribedAt(builder, id, project, '/app/watchers.ts', (text) => text.startsWith('this.bus.all().subscribe'));
    readMessageTypes(host);
    expect(said(builder, id)).toEqual(['HELP:switch:Notify.page', 'READY:switch:Notify.ping']);
    expect(rows).toEqual([]);
  });

  it('reads the method a callback only hands the message to, in the parameter it hands it in', () => {
    const { project, builder, host, consumerAt } = setup();
    const id = consumerAt('app#watchers.ts:Counter.count');
    subscribedAt(builder, id, project, '/app/watchers.ts', (text) => text.startsWith('this.bus.all().subscribe(({ scope, data }) => this.count'));
    readMessageTypes(host);
    expect(said(builder, id)).toEqual(['PLACED:if:Counter.count']);
  });

  it('reads a function written in place that does more than delegate, where it is written', () => {
    const { project, builder, host, consumerAt } = setup();
    const id = consumerAt('app#watchers.ts:Closer.start');
    subscribedAt(builder, id, project, '/app/watchers.ts', (text) => text.startsWith('(data) =>') && text.includes('CLOSED'));
    readMessageTypes(host);
    expect(said(builder, id)).toEqual(['CLOSED:if:Closer.archive']);
  });
});
