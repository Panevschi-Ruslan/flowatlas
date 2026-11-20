import { Node, Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { HANDS_ON_META, recordSubjectSubscribers, subscriptionsOf, UNREACHED_META } from './event-stream.js';
import { classNeverMade, subjectRelayOf } from './stream-subjects.js';

/**
 * A stream's frames handed on through a subject (P362): from the function the
 * frames arrive at, to the subject it pushes them into, to what exposes it, to
 * every subscription in the repository.
 */
const RX = `
export declare class Observable<T> { pipe(...ops: unknown[]): Observable<T>; subscribe(next: (value: T) => void): void }
export declare class Subject<T> extends Observable<T> { next(value: T): void; asObservable(): Observable<T> }
export declare function filter<T>(predicate: (value: T) => boolean): unknown;
export declare function inject<T>(token: new (...args: never[]) => T): T;
`;

const repo = (files: Record<string, string>) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  project.createSourceFile('/app/rx.ts', RX);
  for (const [name, text] of Object.entries(files)) project.createSourceFile(`/app/${name}`, text);
  return project;
};

/** The listener written in place on `onmessage` in a class's method. */
const listenerIn = (project: Project, file: string, className: string) => {
  const owner = project.getSourceFileOrThrow(`/app/${file}`).getClassOrThrow(className);
  const assignment = owner
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .find((each) => each.getLeft().getText().endsWith('.onmessage'))!;
  return { owner, handler: assignment.getRight() };
};

const STREAM = `
import { Subject } from './rx';
export class Stream {
  private readonly _event$ = new Subject<{ type: string }>();
  readonly event$ = this._event$.asObservable();
  get events$() { return this._event$.asObservable(); }
  open() {
    const source = new EventSource('/events');
    source.onmessage = (m) => { const data = JSON.parse(m.data); this._event$.next(data); };
  }
}
`;

describe('subscriptions to what a stream is pushed into', () => {
  it('follows the subject to a field and a getter exposing it, through pipe, in classes it is injected into', () => {
    const project = repo({
      'stream.ts': STREAM,
      'page.ts': `
        import { Stream } from './stream';
        import { filter } from './rx';
        export class Page {
          constructor(private readonly stream: Stream) {}
          init() { this.stream.event$.pipe(filter((e: { type: string }) => e.type === 'A')).subscribe(() => this.load()); }
          load() {}
        }`,
      'panel.ts': `
        import { Stream } from './stream';
        import { inject } from './rx';
        export class Panel {
          private readonly stream = inject(Stream);
          init() { this.stream.events$.subscribe((e) => void e); }
          other() { this.stream.event$.pipe(); }
        }`,
    });
    const { owner, handler } = listenerIn(project, 'stream.ts', 'Stream');
    const relay = subjectRelayOf(handler, owner, project, '/app');
    expect(relay.subjects).toEqual(['Stream._event$']);
    expect(relay.unreached).toBeUndefined();
    expect(relay.subscriptions.map((each) => `${each.subscribe.getSourceFile().getBaseName()} ${each.through}`)).toEqual([
      'page.ts Stream.event$',
      'panel.ts Stream.events$',
    ]);
  });

  it('says a service nothing injects or makes never runs, and its subscribers with it', () => {
    const project = repo({
      'legacy.ts': `
        import { Subject } from './rx';
        export class Legacy {
          readonly events = new Subject<{ type: string }>();
          open() { const source = new EventSource('/x'); source.onmessage = (m) => this.events.next(JSON.parse(m.data)); }
        }`,
      'watcher.ts': `
        import type { Legacy } from './legacy';
        export class Watcher { watch(feed: Legacy) { feed.events.subscribe((e) => void e); } }`,
    });
    const { owner, handler } = listenerIn(project, 'legacy.ts', 'Legacy');
    const relay = subjectRelayOf(handler, owner, project, '/app');
    expect(relay.unreached).toContain('nothing injects or makes Legacy');
    expect(relay.subscriptions).toHaveLength(1);
    expect(relay.subscriptions[0]?.unreached).toContain('Legacy');
  });

  it('reads a class made with new, or listed among providers, as made', () => {
    const project = repo({
      'a.ts': `export class A {}\nexport const a = new A();`,
      'b.ts': `export class B {}\nexport const providers = [B];`,
      'c.ts': `export class C {}\nexport function f(c: C) { return c; }`,
    });
    const classOf = (file: string, name: string) => project.getSourceFileOrThrow(`/app/${file}`).getClassOrThrow(name);
    expect(classNeverMade(classOf('a.ts', 'A'), project, '/app')).toBeUndefined();
    expect(classNeverMade(classOf('b.ts', 'B'), project, '/app')).toBeUndefined();
    expect(classNeverMade(classOf('c.ts', 'C'), project, '/app')).toContain('nothing injects or makes C');
  });

  it('reads no subject where the listener pushes into none', () => {
    const project = repo({
      'plain.ts': `export class Plain { open() { const s = new EventSource('/x'); s.onmessage = (m) => console.log(m.data); } }`,
    });
    const { owner, handler } = listenerIn(project, 'plain.ts', 'Plain');
    expect(subjectRelayOf(handler, owner, project, '/app')).toEqual({ subjects: [], subscriptions: [] });
  });
});

describe('recording the subscribers as consumers of the stream', () => {
  it('draws a consumer per subscribing function, reached from the request, and says on the stream\'s own whom it hands on to', () => {
    const project = repo({
      'stream.ts': STREAM,
      'page.ts': `
        import { Stream } from './stream';
        export class Page { constructor(private readonly stream: Stream) {} init() { this.stream.event$.subscribe(() => undefined); } }`,
    });
    const { owner, handler } = listenerIn(project, 'stream.ts', 'Stream');
    const relay = subjectRelayOf(handler, owner, project, '/app');
    const builder = new GraphBuilder({ repo: 'web', generatedAt: 'fixed' });
    builder.addNode({ id: 'consumer:web#stream.ts:Stream.open', type: 'consumer', label: 'Stream.open', repo: 'web' });
    const rows: unknown[] = [];
    const handsOn = recordSubjectSubscribers(
      builder,
      relay,
      {
        repo: 'web',
        calls: [{ id: 'ui_api_call:web#stream.ts:8:20' }],
        consumerId: 'consumer:web#stream.ts:Stream.open',
        handlerOf: (subscribe) => {
          const method = subscribe.getFirstAncestor((node) => Node.isMethodDeclaration(node));
          return method === undefined || !Node.isMethodDeclaration(method) ? undefined : { id: `web#page.ts:Page.${method.getName()}`, label: `Page.${method.getName()}` };
        },
        fileOf: (node) => node.getSourceFile().getBaseName(),
      },
      (row) => rows.push(row),
    );
    expect(handsOn).toEqual(['consumer:web#page.ts:Page.init']);
    const screen = builder.getNode('consumer:web#page.ts:Page.init');
    expect(subscriptionsOf(screen)).toEqual([{ line: 3, column: 86, through: 'Stream.event$' }]);
    expect(screen?.meta?.[UNREACHED_META]).toBeUndefined();
    expect(builder.getNode('consumer:web#stream.ts:Stream.open')?.meta?.[HANDS_ON_META]).toEqual(['consumer:web#page.ts:Page.init']);
    expect(builder.edges.some((edge) => edge.type === 'triggers' && edge.to === 'consumer:web#page.ts:Page.init')).toBe(true);
    expect(rows).toEqual([]);
  });
});

describe('what reaches a subject, handed on through other classes', () => {
  it('follows a method of another service that answers with it, cast, to the screens subscribed there', () => {
    const project = repo({
      'stream.ts': STREAM,
      'updates.ts': `
        import { Stream } from './stream';
        import { inject, type Observable } from './rx';
        export class Updates {
          private readonly stream = inject(Stream);
          getCardUpdates(): Observable<{ type: string; card: string }> { return this.stream.event$ as Observable<{ type: string; card: string }>; }
        }`,
      'timeline.ts': `
        import { Updates } from './updates';
        export class Timeline {
          constructor(private readonly live: Updates) {}
          init() { this.live.getCardUpdates().subscribe((event) => void event['type']); }
        }`,
    });
    const { owner, handler } = listenerIn(project, 'stream.ts', 'Stream');
    const relay = subjectRelayOf(handler, owner, project, '/app');
    expect(relay.subscriptions.map((each) => `${each.subscribe.getSourceFile().getBaseName()} ${each.through} ${each.entry?.getName()}`)).toEqual([
      'timeline.ts Updates.getCardUpdates Updates',
    ]);
  });

  it('says a subscription through one instance of a generic stream class enters through the class holding that instance', () => {
    const project = repo({
      'live.ts': `
        import { Subject, type Observable } from './rx';
        export class Live<T> {
          private readonly subject = new Subject<T>();
          readonly events$: Observable<T> = this.subject.asObservable();
          open(url: string) { const source = new EventSource(url); source.onmessage = (m) => { this.subject.next(JSON.parse(m.data)); }; }
        }`,
      'crew.ts': `
        import { Live } from './live';
        export class Crew {
          private readonly stream = new Live<{ type: string }>();
          readonly events$ = this.stream.events$;
          connect(id: string) { this.stream.open('/crew/' + id); }
        }`,
      'panel.ts': `
        import { Crew } from './crew';
        export class Panel { constructor(private readonly crew: Crew) {} init() { this.crew.events$.subscribe(() => undefined); } }`,
    });
    const { owner, handler } = listenerIn(project, 'live.ts', 'Live');
    const relay = subjectRelayOf(handler, owner, project, '/app');
    expect(relay.subscriptions.map((each) => `${each.through} ${each.entry?.getName()}`)).toEqual(['Crew.events$ Crew']);
  });

  it('marks a subscription unreached where a class re-exposing the subject is made by nothing', () => {
    const project = repo({
      'stream.ts': STREAM,
      'page.ts': `import { Stream } from './stream';\nexport class Page { constructor(readonly stream: Stream) {} }`,
      'orphan.ts': `
        import type { Stream } from './stream';
        export class Orphan { constructor(private readonly stream: Stream) {} get feed() { return this.stream.event$; } }`,
      'user.ts': `
        import type { Orphan } from './orphan';
        export function use(o: Orphan) { o.feed.subscribe(() => undefined); }`,
    });
    const { owner, handler } = listenerIn(project, 'stream.ts', 'Stream');
    const [subscription] = subjectRelayOf(handler, owner, project, '/app').subscriptions;
    expect(subscription?.through).toBe('Orphan.feed');
    expect(subscription?.unreached).toContain('nothing injects or makes Orphan');
  });
});
