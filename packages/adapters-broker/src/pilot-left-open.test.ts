import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { GraphBuilder, READS_NOTHING_META, selectionsOf, type ClassMethod } from '@flowatlas/core';
import { readMessageTypes, readSubscription, type SelectionReading } from './message-type.js';

/**
 * What a pilot left open after P404 (P405): a set built by spreading other
 * sets, lists and constants written in other files, and a handler run for the
 * types chosen that takes no parameter, so reads nothing of the message.
 */

const SETS = `
export const OTHER_EVENTS: ReadonlySet<string> = new Set(['ORDER_MOVED', 'TABLE_MOVED']);
export enum SeatEvent { Merged = 'TABLE_MERGED' }
export const SEAT_EVENTS = [SeatEvent.Merged] as const;
`;

const SYNC = `export const RESYNC_EVENT = 'RESYNC';
export class ResyncService { resync(): void {} }
`;

const FEED = `
import { OTHER_EVENTS, SEAT_EVENTS } from './sets';
import { RESYNC_EVENT } from './sync';
interface Evt { type: string; [key: string]: unknown }
declare class Observable<T> { subscribe(next: (value: T) => void): void }
declare const events$: Observable<Evt>;
declare function computed(): string;
const LIVE: ReadonlySet<string> = new Set([...OTHER_EVENTS, ...SEAT_EVENTS, RESYNC_EVENT]);
const PARTLY: ReadonlySet<string> = new Set([...OTHER_EVENTS, computed()]);

export class Feed {
  spread() {
    events$.subscribe((evt) => { if (LIVE.has(evt.type)) this.redraw(); });
  }
  computedOne() {
    events$.subscribe((evt) => { if (PARTLY.has(evt.type)) this.redraw(); });
  }
  redraw() {}
}
`;

const project = (): Project => {
  const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  made.createSourceFile('sets.ts', SETS);
  made.createSourceFile('sync.ts', SYNC);
  made.createSourceFile('feed.ts', FEED);
  return made;
};

const subscriptionIn = (made: Project, method: string): SelectionReading => {
  const owner = made.getSourceFileOrThrow('feed.ts').getClassOrThrow('Feed');
  const subscribe = owner
    .getMethodOrThrow(method)
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => call.getExpression().getText().endsWith('.subscribe'))!;
  return readSubscription(subscribe, owner, { repoDir: '/' });
};

describe('a set built by spreading other sets (P405)', () => {
  it('reads the strings of every spread and constant, across files: a set, an as const list of an enum member, an imported constant', () => {
    const reading = subscriptionIn(project(), 'spread');
    expect(reading.selections.map((selection) => selection.type).sort()).toEqual(['ORDER_MOVED', 'RESYNC', 'TABLE_MERGED', 'TABLE_MOVED']);
    expect(reading.unread).toEqual([]);
  });

  it('leaves the set unread where one element is worked out when the code runs', () => {
    const reading = subscriptionIn(project(), 'computedOne');
    expect(reading.selections).toEqual([]);
    expect(reading.unread.map((row) => row.why)).toEqual(['PARTLY.has(evt.type) tests the type against a set the code does not write out.']);
  });
});

const SCREEN = `
interface Evt { type: string; [key: string]: unknown }
declare class Observable<T> {
  pipe(...operators: ((source: Observable<T>) => Observable<T>)[]): Observable<T>;
  subscribe(next: (value: T) => void): void;
}
declare function filter<T>(predicate: (value: T) => boolean): (source: Observable<T>) => Observable<T>;
declare const events$: Observable<Evt>;
const TYPES: ReadonlySet<string> = new Set(['STEP_READY']);

export class Steps {
  refetch() {
    events$.pipe(filter((e) => TYPES.has(e.type))).subscribe(() => this.load());
  }
  handed() {
    events$.subscribe((evt) => { if (evt.type === 'CALL_STAFF') this.show(evt); });
  }
  private load(): void {}
  show(evt: Evt): void { void evt; }
}
`;

describe('a handler that takes no parameter (P405)', () => {
  it('is drawn reading nothing of the message; one handed the message is not', () => {
    const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
    const source = made.createSourceFile('steps.ts', SCREEN);
    const builder = new GraphBuilder({ repo: 'web' });
    const idOf = (method: ClassMethod): string => `web#steps.ts:Steps.${method.getName()}`;
    builder.addNode({ id: 'channel:events', type: 'channel', label: 'events', repo: 'web' });
    for (const name of ['refetch', 'handed']) {
      const subscribe = source
        .getClassOrThrow('Steps')
        .getMethodOrThrow(name)
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find((call) => call.getExpression().getText().endsWith('.subscribe'))!;
      const at = subscribe.getSourceFile().getLineAndColumnAtPos(subscribe.getStart());
      const id = `consumer:web#steps.ts:Steps.${name}`;
      builder.addNode({ id, type: 'consumer', label: `Steps.${name}`, repo: 'web', file: 'steps.ts', line: at.line, meta: { subscriptions: [{ line: at.line, column: at.column }] } });
      builder.addEdge({ from: 'channel:events', to: id, type: 'consumes', confidence: 'static' });
    }
    readMessageTypes({
      repo: 'web',
      repoDir: '/',
      project: made,
      builder,
      report: () => undefined,
      methodIdOf: idOf,
      ensureMethodNode: (method) => builder.addNode({ id: idOf(method), type: 'method', label: idOf(method).split(':').at(-1)!, repo: 'web', file: 'steps.ts', line: method.getStartLineNumber() }),
    });
    expect(selectionsOf(builder.getNode('consumer:web#steps.ts:Steps.refetch')).map((each) => `${each.type}:${each.consumer}`)).toEqual(['STEP_READY:consumer:web#steps.ts:Steps.load']);
    expect(builder.getNode('consumer:web#steps.ts:Steps.load')?.meta?.[READS_NOTHING_META]).toBe(true);
    expect(selectionsOf(builder.getNode('consumer:web#steps.ts:Steps.handed')).map((each) => `${each.type}:${each.consumer}`)).toEqual(['CALL_STAFF:consumer:web#steps.ts:Steps.show']);
    expect(builder.getNode('consumer:web#steps.ts:Steps.show')?.meta?.[READS_NOTHING_META]).toBeUndefined();
  });
});
