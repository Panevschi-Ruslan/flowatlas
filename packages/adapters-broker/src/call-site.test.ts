import { Node, Project, type Node as TsNode } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasAcknowledgement } from './call-site.js';

const SOURCE = `
declare const socket: { emit(event: string, ...rest: unknown[]): void };
declare function onReply(answer: string): void;

const publish = () => socket.emit('order:updated', { id: '1' });
const publishNothing = () => socket.emit('order:updated');
const request = () => socket.emit('order:summary', '1', (answer: string) => void answer);
const requestByName = () => socket.emit('order:summary', '1', onReply);
const carriesAFunction = () => socket.emit('order:updated', { render: () => 1 });
`;

let argsOf: (name: string) => TsNode[];

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('calls.ts', SOURCE);
  argsOf = (name) => {
    const initializer = file.getVariableDeclarationOrThrow(name).getInitializerOrThrow();
    let emit: TsNode | undefined;
    initializer.forEachDescendant((node) => {
      if (emit === undefined && Node.isCallExpression(node)) emit = node;
    });
    if (emit === undefined || !Node.isCallExpression(emit)) throw new Error(`no call in ${name}`);
    return emit.getArguments();
  };
});

describe('a publishing call that hands over somewhere to reply', () => {
  it('reads a callback written at the call site as an acknowledgement', () => {
    expect(hasAcknowledgement(argsOf('request'))).toBe(true);
  });

  it('reads a callback passed by name as the same acknowledgement', () => {
    expect(hasAcknowledgement(argsOf('requestByName'))).toBe(true);
  });

  it('reads a publish with a payload as expecting nothing back', () => {
    expect(hasAcknowledgement(argsOf('publish'))).toBe(false);
  });

  it('reads a publish with nothing but a name as expecting nothing back', () => {
    expect(hasAcknowledgement(argsOf('publishNothing'))).toBe(false);
  });

  // Only the last argument is the acknowledgement; a payload is payload whatever
  // it happens to hold.
  it('does not mistake a payload holding a function for a reply', () => {
    expect(hasAcknowledgement(argsOf('carriesAFunction'))).toBe(false);
  });
});
