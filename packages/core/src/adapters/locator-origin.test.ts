import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { locatedSlots, originsOf, type NameLocator } from './locator.js';

/**
 * A name written one call before the call that acts on it (R171).
 *
 * `const run = await orchestrator.create({ process: Process.LoanApproval });
 * await orchestrator.start({ runId: run.id })` - the second call is handed an
 * id, and the name is in the first.
 */
const parse = (source: string): SourceFile => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('orchestration.ts', 'export declare const orchestrator: any; export declare function create(input: unknown): any; export declare function start(input: unknown): any;');
  return project.createSourceFile('a.ts', source);
};

const lastCallTo = (file: SourceFile, method: string): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((item) => item.getExpression().getText().split('.').pop() === method)
    .at(-1);
  if (call === undefined) throw new Error(`no ${method}() in the source`);
  return call;
};

const PROCESS: NameLocator = { kind: 'origin-call-argument', call: 'create', path: ['process'] };

/** Each slot as text, or nothing written. */
const slots = (site: CallExpression, locator: NameLocator = PROCESS): (string | undefined)[] =>
  locatedSlots(site, locator).map((slot) => slot?.expression.getText());

const HEAD = `import { orchestrator } from './orchestration';\n`;

describe('a name read off the call that made what this call is handed', () => {
  it('follows an id read off a record a const holds, to the call that made the record', () => {
    const file = parse(`${HEAD}export const handler = async () => {
  const run = await orchestrator.create({ process: Process.LoanApproval, loanId: 'l-1' });
  await orchestrator.start({ runId: run.id });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual(['Process.LoanApproval']);
  });

  it('follows the id through a const of its own, a destructuring and a shorthand', () => {
    const file = parse(`${HEAD}export const handler = async () => {
  const { id } = await orchestrator.create({ process: 'lending-loan-approval' });
  const runId = id;
  await orchestrator.start({ runId });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual(["'lending-loan-approval'"]);
  });

  it('reads an argument other than the first, and the argument itself where the path is empty', () => {
    const file = parse(`${HEAD}export const handler = async () => {
  const run = await orchestrator.create('l-1', Process.LoanApproval);
  await orchestrator.start(run.id);
};`);
    expect(slots(lastCallTo(file, 'start'), { kind: 'origin-call-argument', call: 'create', path: [], index: 1 })).toEqual([
      'Process.LoanApproval',
    ]);
  });

  it('reads functions imported from one module as readily as methods of one receiver', () => {
    const file = parse(`import { create as record, start } from './orchestration';
export const handler = async () => {
  const run = await record({ process: Process.LoanApproval });
  await start({ runId: run.id });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual(['Process.LoanApproval']);
  });
});

describe('and nothing, rather than a guess', () => {
  it('for an id the request carries', () => {
    const file = parse(`${HEAD}export const handler = async (event: { runId: string }) => {
  await orchestrator.start({ runId: event.runId });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual([]);
  });

  it('for a record held in a binding that can be reassigned', () => {
    const file = parse(`${HEAD}export const handler = async () => {
  let run = await orchestrator.create({ process: Process.LoanApproval });
  await orchestrator.start({ runId: run.id });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual([]);
  });

  it('for a record made in another body', () => {
    const file = parse(`${HEAD}const run = orchestrator.create({ process: Process.LoanApproval });
export const handler = async () => {
  await orchestrator.start({ runId: run.id });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual([]);
  });

  it('for a record some other call made, or one made on another receiver', () => {
    const file = parse(`${HEAD}export const handler = async (other: any) => {
  const run = await orchestrator.lookup({ process: Process.LoanApproval });
  const elsewhere = await other.create({ process: Process.Reminder });
  await orchestrator.start({ runId: run.id, also: elsewhere.id });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual([]);
  });

  it('for two records, because choosing one of them is the guess', () => {
    const file = parse(`${HEAD}export const handler = async () => {
  const first = await orchestrator.create({ process: Process.LoanApproval });
  const second = await orchestrator.create({ process: Process.Renewal });
  await orchestrator.start({ runs: [first.id, second.id] });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual([]);
  });

  it('for a path that stops at what the body was handed', () => {
    const file = parse(`${HEAD}export const handler = async (input: { process: string }) => {
  const run = await orchestrator.create(input);
  await orchestrator.start({ runId: run.id });
};`);
    expect(slots(lastCallTo(file, 'start'))).toEqual([]);
  });
});

describe('originsOf', () => {
  it('names the call each value was made by and what was read off it', () => {
    const file = parse(`${HEAD}export const handler = async () => {
  const run = await orchestrator.create({});
  const job = makeJob();
  await orchestrator.start({ runId: run.id, owner: job.owner.name }, 'literal');
};`);
    expect(
      originsOf(lastCallTo(file, 'start')).map((origin) => [origin.call.getText(), origin.read, origin.value.getText()]),
    ).toEqual([
      ['orchestrator.create({})', ['id'], 'run.id'],
      ['makeJob()', ['owner', 'name'], 'job.owner.name'],
    ]);
  });
});
