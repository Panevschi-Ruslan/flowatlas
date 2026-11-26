import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { GraphBuilder, restSelectionsOf, selectionsOf, type ClassMethod } from '@flowatlas/core';
import { readMessageTypes, readSelections, type ChosenHandler, type MessageTypeHost, type SelectionReading } from './message-type.js';

/**
 * The `else` or `default` that ends a choice on the type (P400): its handler
 * takes what the branches before it do not choose, which only the linker can
 * name, so the reader records the types the branches choose and the handler.
 */
const SOURCE = `
export interface Message { type: string; id: string }

export class Relay {
  chain(event: Message): void {
    if (event.type === 'A') {
      this.onA(event);
    } else if (event.type === 'B' || event.type === 'C') {
      this.onB(event);
    } else {
      this.onRest(event);
    }
  }

  single(event: Message): void {
    if (event.type === 'A') this.onA(event);
    else this.onRest(event);
  }

  switched(event: Message): void {
    switch (event.type) {
      case 'A':
        return this.onA(event);
      case 'B':
        return this.onB(event);
      default:
        this.onRest(event);
    }
  }

  ignoresOtherwise(event: Message): string {
    switch (event.type) {
      case 'A':
        return 'a';
      default:
        return 'ignored';
    }
  }

  throwsOtherwise(event: Message): void {
    switch (event.type) {
      case 'A':
        return this.onA(event);
      default:
        throw new Error('unknown');
    }
  }

  noElse(event: Message): void {
    if (event.type === 'A') this.onA(event);
    else if (event.type === 'B') this.onB(event);
  }

  mixed(event: Message, flag: boolean): void {
    if (event.type === 'A') this.onA(event);
    else if (flag) this.onB(event);
    else this.onRest(event);
  }

  onA(event: Message): void { void event; }
  onB(event: Message): void { void event; }
  onRest(event: Message): void { void event; }
}

export class Router {
  constructor(private readonly handlers: Handlers) {}

  route(body: { message: Message }): string {
    const event = body.message;
    if (event.type === 'READY') {
      return this.handlers.ready(event);
    } else {
      return this.handlers.other(event);
    }
  }
}

export class Handlers {
  ready(event: Message): string { return event.id; }
  other(event: Message): string { return event.id; }
}
`;

const setup = () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const file = project.createSourceFile('/app/relay.ts', SOURCE);
  return { project, file };
};

const handlerName = (handler: ChosenHandler): string => (handler.kind === 'method' ? (handler.method.getName() ?? '?') : handler.kind);
const rests = (reading: SelectionReading): string[] =>
  (reading.rest ?? []).map((each) => `${handlerName(each.handler)} but ${[...each.excluding].sort().join(',')}`);

describe('the else that ends a choice on the type (P400)', () => {
  const { file } = setup();
  const owner = file.getClassOrThrow('Relay');
  const read = (method: string): SelectionReading => readSelections(owner.getMethodOrThrow(method), owner, { repoDir: '/app' });

  it('records the handler of the last else of an if, else if chain with every type its tests choose', () => {
    expect(rests(read('chain'))).toEqual(['onRest but A,B,C']);
    expect(rests(read('single'))).toEqual(['onRest but A']);
  });

  it("records a switch's default, beside saying it hands every other type on", () => {
    const reading = read('switched');
    expect(rests(reading)).toEqual(['onRest but A,B']);
    expect(reading.others).toBe(true);
  });

  it('records nothing for a default that only throws or answers a value, a chain with no else, or a test in the chain about something else', () => {
    expect(rests(read('throwsOtherwise'))).toEqual([]);
    expect(rests(read('ignoresOtherwise'))).toEqual([]);
    expect(rests(read('noElse'))).toEqual([]);
    expect(rests(read('mixed'))).toEqual([]);
  });

  it("records a consumer called in its caller's last else, the types the caller chooses before it excluded", () => {
    const { project } = setup();
    const builder = new GraphBuilder({ repo: 'app' });
    const methodIdOf = (declaration: ClassMethod): string | undefined => {
      const parent = declaration.getParent() as { getName?(): string };
      return parent.getName === undefined ? undefined : `app#relay.ts:${parent.getName()}.${declaration.getName()}`;
    };
    for (const each of project.getSourceFileOrThrow('/app/relay.ts').getClasses()) {
      for (const method of each.getMethods()) {
        const id = methodIdOf(method)!;
        builder.addNode({ id, type: 'method', label: id.slice(id.lastIndexOf(':') + 1), repo: 'app', file: 'relay.ts', line: method.getStartLineNumber() });
      }
    }
    const host: MessageTypeHost = { repo: 'app', repoDir: '/app', project, builder, methodIdOf, ensureMethodNode: (method) => builder.getNode(methodIdOf(method)!), report: () => undefined };
    builder.addNode({ id: 'channel:orders', type: 'channel', label: 'orders', repo: 'app' });
    for (const name of ['ready', 'other']) {
      const handler = `app#relay.ts:Handlers.${name}`;
      builder.addNode({ id: `consumer:${handler}`, type: 'consumer', label: `Handlers.${name}`, repo: 'app', file: 'relay.ts', line: builder.getNode(handler)!.line! });
      builder.addEdge({ from: `consumer:${handler}`, to: handler, type: 'handles', confidence: 'static' });
      builder.addEdge({ from: 'channel:orders', to: `consumer:${handler}`, type: 'consumes', confidence: 'static' });
      builder.addEdge({ from: 'app#relay.ts:Router.route', to: handler, type: 'calls', confidence: 'static' });
    }
    readMessageTypes(host);
    const other = builder.getNode('consumer:app#relay.ts:Handlers.other');
    expect(selectionsOf(other)).toEqual([]);
    expect(restSelectionsOf(other)).toEqual([{ consumer: 'consumer:app#relay.ts:Handlers.other', excluding: ['READY'], line: expect.any(Number) }]);
    expect(selectionsOf(builder.getNode('consumer:app#relay.ts:Handlers.ready')).map((each) => `${each.type}:${each.via}`)).toEqual(['READY:if']);
  });
});
