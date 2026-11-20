import { Project, SyntaxKind, type NewExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { delegateOf, isEventSourceConstruction, recordStreamConsumer, streamHoldingOf } from './event-stream.js';

/** The streams written in one file, in the order they are written. */
const streamsIn = (text: string): NewExpression[] => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { lib: ['lib.dom.d.ts', 'lib.es2022.d.ts'] } });
  const file = project.createSourceFile('/web/src/a.ts', text);
  return file.getDescendantsOfKind(SyntaxKind.NewExpression).filter(isEventSourceConstruction);
};

const only = (text: string): NewExpression => {
  const [stream] = streamsIn(text);
  if (stream === undefined) throw new Error('no stream in the sample');
  return stream;
};

const listenersOf = (text: string): Array<[string | null, string]> =>
  streamHoldingOf(only(text)).listeners.map((listener) => [listener.event, listener.handler.getText()]);

describe('the browser stream a construction is (P359)', () => {
  it('is the global client, and not a class of the repository by that name', () => {
    expect(streamsIn("const s = new EventSource('/events');")).toHaveLength(1);
    expect(streamsIn("export class EventSource { constructor(_: string) {} }\nconst s = new EventSource('/events');")).toHaveLength(0);
  });
});

describe('the functions a stream hands its frames to', () => {
  it('reads onmessage and named listeners on the name the stream is bound to', () => {
    expect(
      listenersOf(
        [
          'function open(onEvent: (e: MessageEvent) => void) {',
          "  const source = new EventSource('/events');",
          '  source.onmessage = onEvent;',
          "  source.addEventListener('parcel', (e) => onEvent(e));",
          "  source.addEventListener('error', () => source.close());",
          '  source.onerror = () => undefined;',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      ['message', 'onEvent'],
      ['parcel', '(e) => onEvent(e)'],
    ]);
  });

  it('reads listeners on a field the stream is written to, anywhere in the class', () => {
    expect(
      listenersOf(
        [
          'class Live {',
          '  private source: EventSource | null = null;',
          "  open() { this.source = new EventSource('/events'); this.listen(); }",
          '  listen() { this.source?.addEventListener(name(), (e) => this.handle(e)); }',
          '  handle(e: MessageEvent) { return e; }',
          '}',
          'declare function name(): string;',
        ].join('\n'),
      ),
    ).toEqual([[null, '(e) => this.handle(e)']]);
  });

  it('does not take a name shadowed in an inner function for the stream', () => {
    expect(
      listenersOf(
        [
          'function open() {',
          "  const source = new EventSource('/events');",
          "  const other = (source: EventSource) => { source.onmessage = () => 1; };",
          '  return other;',
          '}',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('says a stream handed back is held by the caller', () => {
    expect(streamHoldingOf(only("function open() { return new EventSource('/events'); }"))).toEqual({ listeners: [], returned: true });
    expect(streamHoldingOf(only("const open = () => new EventSource('/events');")).returned).toBe(true);
  });

  it('follows a listener written in place to the one name it calls', () => {
    const [listener] = streamHoldingOf(only("const s = new EventSource('/e');\ns.onmessage = (m) => { handle(JSON.parse(m.data)); };\ndeclare function handle(x: unknown): void;")).listeners;
    expect(listener === undefined ? undefined : delegateOf(listener.handler)?.getText()).toBe('handle');
    const [busy] = streamHoldingOf(only("const s = new EventSource('/e');\ns.onmessage = (m) => { a(m); b(m); };\ndeclare function a(x: unknown): void;\ndeclare function b(x: unknown): void;")).listeners;
    expect(busy === undefined ? 'none' : delegateOf(busy.handler)).toBeUndefined();
  });
});

describe('the consumer a stream feeds', () => {
  it('is a consumer of its own kind that handles the function and that the request triggers', () => {
    const builder = new GraphBuilder({ repo: 'web' });
    const id = recordStreamConsumer(builder, {
      repo: 'web',
      callId: 'ui_api_call:web#src/a.ts:2:18',
      handlerId: 'web#src/a.ts:onEvent',
      label: 'onEvent',
      file: 'src/a.ts',
      line: 3,
      events: ['message', null],
      confidence: 'static',
    });
    expect(id).toBe('consumer:web#src/a.ts:onEvent');
    expect(builder.getNode(id)).toMatchObject({ type: 'consumer', kind: 'sse', meta: { kind: 'sse', client: 'EventSource', events: ['?', 'message'], entryId: null } });
    expect(builder.edges.map((edge) => [edge.from, edge.type, edge.to])).toEqual([
      [id, 'handles', 'web#src/a.ts:onEvent'],
      ['ui_api_call:web#src/a.ts:2:18', 'triggers', id],
    ]);
  });
});
