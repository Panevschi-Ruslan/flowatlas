import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { streamEventsIn } from './stream-relays.js';

const eventsOf = (text: string, declared = false) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  return streamEventsIn([project.createSourceFile('/api/src/a.ts', text)], declared);
};

/** The names a stream's frames go under (P388). */
describe('the events a stream of server-sent events sends', () => {
  it('reads frames written out, named and not', () => {
    expect(eventsOf('res.write(`event: order-ready\\ndata: ${JSON.stringify(x)}\\n\\n`);')).toEqual({ events: ['order-ready'], unread: false });
    expect(eventsOf('res.write(`data: ${JSON.stringify(x)}\\n\\n`);')).toEqual({ events: ['message'], unread: false });
    expect(eventsOf('res.write(`event: ${name}\\ndata: x\\n\\n`);')).toEqual({ events: [], unread: true });
  });

  it("reads Hono's writeSSE and the type of Nest's MessageEvent, whose type Nest sends as the frame's event", () => {
    expect(eventsOf("stream.writeSSE({ event: 'tick', data: 'x' }); stream.writeSSE({ data: 'y' });")).toEqual({ events: ['message', 'tick'], unread: false });
    expect(eventsOf("source.pipe(map((v) => ({ data: v, type: 'order-ready' })));", true)).toEqual({ events: ['order-ready'], unread: false });
    expect(eventsOf('source.pipe(map((v) => ({ data: v, type: v.kind })));', true)).toEqual({ events: [], unread: true });
    // An object of another shape is not a frame.
    expect(eventsOf("return { data: v, type: 'order-ready', total: 3 };", true)).toEqual({ events: [], unread: true });
  });

  it('says it is unread where a name line and a data line are written apart, or no frame is written where it looks', () => {
    expect(eventsOf("res.write('event: ping\\n'); res.write(`data: ${x}\\n\\n`);")).toEqual({ events: ['ping'], unread: true });
    expect(eventsOf('return this.subject.asObservable();', true)).toEqual({ events: [], unread: true });
  });
});
