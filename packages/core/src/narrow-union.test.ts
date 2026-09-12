import { Project, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { narrowUnionByLiteral } from './origin.js';

const SOURCE = `
export interface Created { type: 'CREATED'; orderId: string }
export interface Paid { type: 'PAID'; orderId: string; amount: number }
export interface Cancelled { type: 'CANCELLED'; reason: string }
export type AnyEvent = Created | Paid | Cancelled;
export type Kinds = 'CREATED' | 'PAID';

export declare function publish(channel: string, event: AnyEvent): void;
export declare function send(channel: string, body: Created): void;

export function sites(kind: Kinds, amount: number) {
  publish('a', { type: 'PAID', orderId: 'o1', amount });
  const built = { type: 'CREATED' as const, orderId: 'o1' };
  publish('b', built);
  publish('c', { type: kind, orderId: 'o1' } as AnyEvent);
  send('d', { type: 'CREATED', orderId: 'o1' });
}
`;

describe('narrowing a declared union to what a call actually sends', () => {
  let file: SourceFile;

  beforeAll(() => {
    const project = new Project({ useInMemoryFileSystem: true });
    file = project.createSourceFile('bus.ts', SOURCE);
  });

  const callAt = (index: number) => {
    const body = file.getFunctionOrThrow('sites').getBodyOrThrow();
    const calls = body
      .getDescendantStatements()
      .flatMap((statement) => statement.getDescendantsOfKind(214));
    return calls[index];
  };

  const narrowedName = (index: number, argumentIndex = 1): string => {
    const call = callAt(index);
    if (call === undefined) throw new Error(`no call at ${index}`);
    const signature = call.getReturnType();
    void signature;
    const argument = call.getArguments()[argumentIndex];
    if (argument === undefined) throw new Error('no argument');
    const declared = file.getTypeAliasOrThrow('AnyEvent').getType();
    return narrowUnionByLiteral(declared, argument).getText();
  };

  it('reads the discriminant off a value written at the call site', () => {
    expect(narrowedName(0)).toContain('Paid');
  });

  it('reads it off the type of a value built earlier and passed by name', () => {
    expect(narrowedName(1)).toContain('Created');
  });

  it('keeps the whole union when the discriminant is itself a variable', () => {
    expect(narrowedName(2)).toContain('AnyEvent');
  });

  it('leaves a type that is not a union alone', () => {
    const call = callAt(3);
    const argument = call?.getArguments()[1];
    const declared = file.getInterfaceOrThrow('Created').getType();
    if (argument !== undefined) {
      expect(narrowUnionByLiteral(declared, argument).getText()).toContain('Created');
    }
  });
});
