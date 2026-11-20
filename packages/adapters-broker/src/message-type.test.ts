import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { GraphBuilder, selectionsOf } from '@flowatlas/core';
import { readMessageType, readMessageTypes, readSelections, readSubscription, type ChosenHandler, type SelectionReading } from './message-type.js';

/**
 * The types of message one channel carries (P358): the value a send writes
 * into its payload, and the values a handler chooses on, with the handler
 * each choice runs.
 */
const SOURCE = `
export enum Kind { Shipped = 'PARCEL_SHIPPED' }
export const KINDS = { packed: 'PARCEL_PACKED' } as const;
export interface Packed { type: 'PARCEL_PACKED'; id: string }
export interface Shipped { type: Kind.Shipped; id: string }
export interface Lost { type: 'PARCEL_LOST'; id: string }
export type ParcelEvent = Packed | Shipped | Lost;

declare function send(channel: string, message: unknown): void;
declare const anyKind: string;

export const lost = (id: string): Lost => ({ type: 'PARCEL_LOST', id });

export function sends(event: ParcelEvent, shipped: Shipped) {
  send('a', { type: 'PARCEL_PACKED', id: '1' });
  send('a', { type: Kind.Shipped, id: '1' });
  send('a', { type: KINDS.packed, id: '1' });
  const typed: Packed = { type: 'PARCEL_PACKED', id: '1' };
  send('a', typed);
  send('a', lost('1'));
  send('a', JSON.stringify({ type: 'PARCEL_PACKED', id: '1' }));
  send('a', event);
  send('a', { type: anyKind, id: '1' });
  send('a', { id: '1' });
  send('a', shipped);
  send('a', { ...shipped, id: '2' });
  send('a', { kind: 'PARCEL_LOST', id: '1' });
}

export class Handlers {
  private readonly table: Record<string, (event: ParcelEvent) => void> = {
    PARCEL_PACKED: (event) => this.onPacked(event),
    [Kind.Shipped]: this.onShipped.bind(this),
  };
  private readonly labels = { PARCEL_PACKED: 'packed', PARCEL_SHIPPED: 'shipped' } as Record<string, string>;

  switched(event: ParcelEvent): void {
    switch (event.type) {
      case 'PARCEL_PACKED':
        return this.onPacked(event);
      case Kind.Shipped:
      case 'PARCEL_LOST':
        this.log('x');
        this.onShipped(event);
        break;
      default:
        this.forward(event);
    }
  }

  chained(event: ParcelEvent): void {
    if (event.type === 'PARCEL_PACKED') {
      this.onPacked(event);
    } else if (event.type === KINDS.packed || event.type === 'PARCEL_LOST') {
      this.onShipped(event);
    }
  }

  guarded(event: ParcelEvent): void {
    if (event.type !== 'PARCEL_LOST') return;
    this.onShipped(event);
  }

  guardedInline(raw: string): void {
    const data = JSON.parse(raw);
    if (data.type !== 'PARCEL_LOST' && data.type !== 'PARCEL_PACKED') return;
    void data.id;
  }

  mapped(event: ParcelEvent): void {
    this.table[event.type]?.(event);
  }

  labelled(event: ParcelEvent): string {
    return this.labels[event.type] ?? '';
  }

  destructured({ type, id }: ParcelEvent): void {
    if (type === 'PARCEL_SHIPPED') this.onShipped({ type, id } as Shipped);
  }

  generic(event: ParcelEvent): void {
    this.forward(event);
  }

  unreadCase(event: ParcelEvent, other: string): void {
    switch (event.type) {
      case other:
        this.onPacked(event);
    }
  }

  onPacked(event: ParcelEvent): void { void event; }
  onShipped(event: ParcelEvent): void { void event; }
  forward(event: ParcelEvent): void { void event; }
  log(text: string): void { void text; }
}
`;

let project: Project;
let file: ReturnType<Project['createSourceFile']>;

beforeAll(() => {
  project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  file = project.createSourceFile('parcels.ts', SOURCE);
});

const sendAt = (index: number): CallExpression =>
  file
    .getFunctionOrThrow('sends')
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => call.getExpression().getText() === 'send')[index]!;

const read = (index: number) => readMessageType(sendAt(index).getArguments()[1]);

describe('the type a send writes into its payload', () => {
  it('reads a literal written in place, an enum member and a constant object member', () => {
    expect(read(0)).toEqual({ field: 'type', types: ['PARCEL_PACKED'] });
    expect(read(1)).toEqual({ field: 'type', types: ['PARCEL_SHIPPED'] });
    expect(read(2)).toEqual({ field: 'type', types: ['PARCEL_PACKED'] });
  });

  it('follows a typed constant, a helper of the project whose answer is written out, and text made of an object', () => {
    expect(read(3)).toEqual({ field: 'type', types: ['PARCEL_PACKED'] });
    expect(read(4)).toEqual({ field: 'type', types: ['PARCEL_LOST'] });
    expect(read(5)).toEqual({ field: 'type', types: ['PARCEL_PACKED'] });
  });

  it('says why where the payload is a union decided by a caller, or the type a value worked out at run time', () => {
    const union = read(6);
    expect(union).toMatchObject({ field: 'type' });
    expect(union !== undefined && 'why' in union && union.why).toContain('may be any of 3 types');
    const runtime = read(7);
    expect(runtime !== undefined && 'why' in runtime && runtime.why).toContain('worked out when the code runs');
  });

  it('reads nothing where the payload has no type', () => {
    expect(read(8)).toBeUndefined();
  });

  it('reads a member of the union the payload is typed by, and a spread of one', () => {
    expect(read(9)).toEqual({ field: 'type', types: ['PARCEL_SHIPPED'] });
    expect(read(10)).toEqual({ field: 'type', types: ['PARCEL_SHIPPED'] });
  });

  it('reads another discriminator where the payload has no type', () => {
    expect(read(11)).toEqual({ field: 'kind', types: ['PARCEL_LOST'] });
  });
});

const owner = () => file.getClassOrThrow('Handlers');
const selections = (method: string): SelectionReading =>
  readSelections(owner().getMethodOrThrow(method), owner(), { repoDir: '/' });
const handlerName = (handler: ChosenHandler): string =>
  handler.kind === 'method' ? (handler.method.getName() ?? '?') : handler.kind === 'function' ? handler.fn.name : handler.kind;
const pairs = (reading: SelectionReading): string[] =>
  reading.selections.map((selection) => `${selection.type}:${selection.via}:${handlerName(selection.handler)}`).sort();

describe('the types a handler chooses on', () => {
  it('reads a switch, its cases falling through, and the call each runs that is handed the message', () => {
    const reading = selections('switched');
    expect(pairs(reading)).toEqual(['PARCEL_LOST:switch:onShipped', 'PARCEL_PACKED:switch:onPacked', 'PARCEL_SHIPPED:switch:onShipped']);
    // The default hands every other type on, the same way: not a choice of any one.
    expect(reading.others).toBe(true);
  });

  it('reads an if and the else ifs after it, an || of values included', () => {
    expect(pairs(selections('chained'))).toEqual(['PARCEL_LOST:if:onShipped', 'PARCEL_PACKED:if:onPacked', 'PARCEL_PACKED:if:onShipped']);
  });

  it('reads a guard returning early: what follows it handles the type, or the handler itself does', () => {
    expect(pairs(selections('guarded'))).toEqual(['PARCEL_LOST:guard:onShipped']);
    expect(pairs(selections('guardedInline'))).toEqual(['PARCEL_LOST:guard:self', 'PARCEL_PACKED:guard:self']);
  });

  it('reads a record of handlers looked up by the type, and not a record of labels', () => {
    expect(pairs(selections('mapped'))).toEqual(['PARCEL_PACKED:map:onPacked', 'PARCEL_SHIPPED:map:onShipped']);
    expect(selections('labelled').selections).toEqual([]);
  });

  it('reads the type taken apart in the parameter', () => {
    expect(pairs(selections('destructured'))).toEqual(['PARCEL_SHIPPED:if:onShipped']);
  });

  it('draws nothing for a handler that takes every type alike', () => {
    const reading = selections('generic');
    expect(reading.selections).toEqual([]);
    expect(reading.unread).toEqual([]);
  });

  it('says why where a case is not a value the code states', () => {
    const reading = selections('unreadCase');
    expect(reading.selections).toEqual([]);
    expect(reading.unread[0]?.why).toContain('case other is not a value the code states');
  });
});

describe('the types any consumer chooses on, whichever reader drew it', () => {
  const SCREEN = `
declare class EventSource { constructor(url: string); onmessage: ((message: { data: string }) => void) | null }
export class ParcelBoard {
  private source = new EventSource('/api/parcels/stream');
  start(): void {
    this.source.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.type === 'PARCEL_SHIPPED') this.flash(data);
      else if (data.type === 'PARCEL_LOST') this.alarm(data);
    };
  }
  flash(data: unknown): void { void data; }
  alarm(data: unknown): void { void data; }
}
`;

  it('reads a handler written in place, found where the consumer says it is, with no method or function node behind it', () => {
    const screens = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const source = screens.createSourceFile('board.ts', SCREEN);
    const handler = source.getDescendantsOfKind(SyntaxKind.ArrowFunction)[0]!;
    const builder = new GraphBuilder({ repo: 'board' });
    // As a browser reader may draw a screen's message handler: a consumer at
    // the handler, consuming the stream's channel, with no handler node.
    const id = 'consumer:board#board.ts:6';
    builder.addNode({ id: 'channel:parcels', type: 'channel', label: 'parcels', repo: 'board' });
    builder.addNode({ id, type: 'consumer', label: 'ParcelBoard onmessage', repo: 'board', file: 'board.ts', line: handler.getStartLineNumber() });
    builder.addEdge({ from: 'channel:parcels', to: id, type: 'consumes', confidence: 'static' });
    const rows: unknown[] = [];
    // A reader that draws no methods: each branch is handled where it is written.
    readMessageTypes({ repo: 'board', repoDir: '/', project: screens, builder, report: (row) => rows.push(row) });
    const consumer = builder.getNode(id);
    expect(selectionsOf(consumer).map((selection) => `${selection.type}:${selection.via}:${selection.consumer}`)).toEqual([
      `PARCEL_LOST:if:${id}`,
      `PARCEL_SHIPPED:if:${id}`,
    ]);
    expect(consumer?.meta?.['discriminator']).toBe('type');
    expect(rows).toEqual([]);
  });
});

describe('the types a subscription chooses, in its operators and its callback (P362)', () => {
  const SCREENS = `
  interface Evt { type: string; [key: string]: unknown }
  declare class Observable<T> {
    pipe(...operators: ((source: Observable<T>) => Observable<T>)[]): Observable<T>;
    subscribe(next: (value: T) => void): void;
  }
  declare function filter<T>(predicate: (value: T) => boolean): (source: Observable<T>) => Observable<T>;
  declare function takeUntil<T>(notifier: unknown): (source: Observable<T>) => Observable<T>;
  declare const events$: Observable<Evt>;
  const REFRESH_ON: ReadonlySet<string> = new Set(['MOVED', 'ARCHIVED']);
  const LISTED = ['ADDED'] as const;

  export class Screen {
    private readonly flashOn = new Set<string>(['RENAMED']);
    piped() {
      events$.pipe(filter((evt) => evt.type === 'MOVED' || evt.type === 'ADDED'), takeUntil(null)).subscribe(() => this.load());
    }
    narrowed() {
      events$.pipe(filter((evt) => ['MOVED', 'ADDED'].includes(evt.type))).subscribe((evt) => {
        if (evt.type === 'ADDED') this.flash();
        if (evt.type === 'RENAMED') this.flash();
      });
    }
    bySet() {
      events$.subscribe((evt) => { if (REFRESH_ON.has(evt.type)) this.load(); });
    }
    byField() {
      events$.subscribe((evt) => { if (this.flashOn.has(evt.type)) this.flash(); });
    }
    byList() {
      events$.subscribe((evt) => { if ((LISTED as readonly string[]).includes(evt.type)) this.flash(); });
    }
    everything() {
      events$.subscribe(() => this.load());
    }
    load() {}
    flash() {}
  }`;
  let screens: ReturnType<Project['createSourceFile']>;
  beforeAll(() => {
    screens = project.createSourceFile('screens.ts', SCREENS);
  });
  const subscriptionIn = (method: string): SelectionReading => {
    const owner = screens.getClassOrThrow('Screen');
    const subscribe = owner
      .getMethodOrThrow(method)
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getExpression().getText().endsWith('.subscribe'))!;
    return readSubscription(subscribe, owner, { repoDir: '/' });
  };

  it('reads the types a filter lets through, handled by what the callback calls', () => {
    expect(pairs(subscriptionIn('piped'))).toEqual(['ADDED:filter:load', 'MOVED:filter:load']);
  });

  it('keeps of what the callback chooses only what the filter lets through', () => {
    expect(pairs(subscriptionIn('narrowed'))).toEqual(['ADDED:if:flash']);
  });

  it('reads a test against a constant set, a set a field holds, and a constant list', () => {
    expect(pairs(subscriptionIn('bySet'))).toEqual(['ARCHIVED:if:load', 'MOVED:if:load']);
    expect(pairs(subscriptionIn('byField'))).toEqual(['RENAMED:if:flash']);
    expect(pairs(subscriptionIn('byList'))).toEqual(['ADDED:if:flash']);
  });

  it('reads no choice where the subscription takes every type', () => {
    expect(subscriptionIn('everything').selections).toEqual([]);
  });
});

describe('a type read in brackets in a subscription (P362)', () => {
  it('chooses on event[\'type\'] as on event.type, an early return ending the branch', () => {
    const file = project.createSourceFile(
      'brackets.ts',
      `
      interface Evt { type: string; [key: string]: unknown }
      declare const updates$: { subscribe(next: (value: Evt) => void): void };
      export class Timeline {
        init() {
          updates$.subscribe((event) => {
            if (event['type'] === 'ADDED') { this.append(); return; }
            if (event['type'] === 'MOVED') this.reorder();
          });
        }
        append() {}
        reorder() {}
      }`,
    );
    const owner = file.getClassOrThrow('Timeline');
    const subscribe = owner.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => call.getExpression().getText().endsWith('.subscribe'))!;
    expect(pairs(readSubscription(subscribe, owner, { repoDir: '/' }))).toEqual(['ADDED:if:append', 'MOVED:if:reorder']);
  });
});
