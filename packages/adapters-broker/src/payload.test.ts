import { Project } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { payloadParameter, typeAtPath } from './payload.js';

const SOURCE = `
interface SendEmail { to: string }
interface Envelope { name: string; data: SendEmail }
declare const envelope: Envelope;
declare const message: SendEmail;

declare function marks(): ParameterDecorator;

class Handlers {
  ordered(connection: string, body: SendEmail): void { void connection; void body; }
  marked(@marks() body: SendEmail, connection?: string): void { void body; void connection; }
  none(): void {}
}
void Handlers;
`;

let project: Project;
let file: ReturnType<Project['createSourceFile']>;

beforeAll(() => {
  project = new Project({ useInMemoryFileSystem: true });
  file = project.createSourceFile('handlers.ts', SOURCE);
});

const typeOf = (name: string) => file.getVariableDeclarationOrThrow(name);
const methodOf = (name: string) => file.getClassOrThrow('Handlers').getMethodOrThrow(name);

describe('the message inside the value a transport moves', () => {
  it('reads the message where the description says it sits', () => {
    const site = typeOf('envelope');
    expect(typeAtPath(site.getType(), ['data'], site)?.getText()).toBe('SendEmail');
  });

  // The default: a description that says nothing names the whole value.
  it('names the whole value when the path is empty', () => {
    const site = typeOf('message');
    expect(typeAtPath(site.getType(), [], site)?.getText()).toBe('SendEmail');
  });

  // The judgement worth a test of its own: answering with the wrapper here is
  // how a correct handler came to be accused of requiring fields nobody sends.
  it('answers nothing rather than the wrapper when the path does not fit', () => {
    const site = typeOf('message');
    expect(typeAtPath(site.getType(), ['data'], site)).toBeUndefined();
  });
});

describe('which parameter a handler is given the message in', () => {
  it('takes the position the description names', () => {
    expect(payloadParameter(methodOf('ordered').getParameters(), { payloadArg: 1 })?.getName()).toBe(
      'body',
    );
  });

  // Where a handler marks the message, where it was written says nothing.
  it('prefers a parameter the handler marked over the position', () => {
    expect(
      payloadParameter(methodOf('marked').getParameters(), {
        payloadArg: 1,
        payloadDecorator: 'marks',
      })?.getName(),
    ).toBe('body');
  });

  it('takes the first parameter when the description names neither', () => {
    expect(payloadParameter(methodOf('ordered').getParameters(), {})?.getName()).toBe('connection');
  });

  it('answers nothing for a handler that declares no parameters', () => {
    expect(payloadParameter(methodOf('none').getParameters(), {})).toBeUndefined();
  });
});
