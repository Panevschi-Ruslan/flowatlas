import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { evaluateExpression } from './static-value.js';
import { statedOrigin } from './stated-origin.js';

/**
 * Two readings a layer a repository writes over its queue needs (P267): a job
 * named after the class that handles it, and a client kept in a registry of
 * the library's clients when the library is not installed.
 */
const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);

const initialiserOf = (file: SourceFile, name: string) => {
  const initialiser = file.getVariableDeclaration(name)?.getInitializer();
  if (initialiser === undefined) throw new Error(`no ${name}`);
  return initialiser;
};

describe("a class's name read off the class", () => {
  const file = parse(`class SendMailJob {}
class Named { static readonly name = 'custom'; }
const notAClass = { name: 'x' };
const plain = SendMailJob.name;
const own = Named.name;
const other = notAClass.name;`);

  it('is the name the class is declared with', () => {
    expect(evaluateExpression(initialiserOf(file, 'plain'))).toEqual({ resolved: true, value: 'SendMailJob' });
  });

  it('is what the class declares where it declares a static name of its own', () => {
    expect(evaluateExpression(initialiserOf(file, 'own'))).toEqual({ resolved: true, value: 'custom' });
  });

  it('is not read off anything but a class', () => {
    expect(evaluateExpression(initialiserOf(file, 'other'))).toEqual({ resolved: true, value: 'x' });
  });
});

describe('an entry of a registry of clients, with nothing installed', () => {
  const file = parse(`import { Queue } from '@acme/jobs';
class Driver {
  private readonly queues: Partial<Record<string, Queue>> = {};
  private readonly byName = new Map<string, Queue>() as Map<string, Queue>;
  private readonly list: Queue[] = [];
  private readonly loose: { [name: string]: Queue } = {};
  a(name: string) { return this.queues[name]; }
  b(name: string) { return this.byName.get(name); }
  c(index: number) { return this.list[index]; }
  d(name: string) { return this.loose[name]; }
}`);
  const returned = (method: string) => {
    const statement = file.getClassOrThrow('Driver').getMethodOrThrow(method).getFirstDescendantByKindOrThrow(SyntaxKind.ReturnStatement);
    const expression = statement.getExpression();
    if (expression === undefined) throw new Error('no return');
    return expression;
  };

  it.each(['a', 'b', 'c', 'd'])('is the class the registry is annotated to hold (%s)', (method) => {
    expect(statedOrigin(returned(method))).toEqual({ package: '@acme/jobs', typeName: 'Queue' });
  });
});
