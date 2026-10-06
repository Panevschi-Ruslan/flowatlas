import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { unwrapWork, wrappedBy } from './wrapped-work.js';

/**
 * The one rule for a wrapper, asked of calls written in a small program (R167).
 *
 * `/src/wrappers.ts` holds wrappers of this repository, `@lending/tracing` is an
 * installed package that declares its wrapper, and `@lending/telemetry` is
 * imported and not installed.
 */
const WRAPPERS = `
type Work = (event: unknown, context?: unknown) => Promise<unknown>;

export const traced = (name: string, fn: Work): Work => async (event, context) => {
  try {
    return await fn(event, context);
  } finally {
    console.log(name);
  }
};

export function withRetry(options: { attempts: number }, fn: Work): Work {
  return async (event, context) => {
    const result = await fn(event, context);
    return result;
  };
}

export const withTimeout = (fn: Work, options: { ms: number }): Work => (...args) => fn(...args);

export const viaApply = (name: string, fn: Work): Work => function (this: unknown) {
  return fn.apply(this, arguments as any);
};

export const identity = (name: string, fn: Work): Work => fn;

// Calls what it was handed with one piece of a request, and answers itself: a factory.
export const listFactory = (ownerOf: (event: unknown) => string): Work => async (event) => {
  const owner = ownerOf(event);
  return { owner };
};

// Calls what it was handed while it is being built: not a wrapper either.
export const eager = (name: string, fn: Work): Work => {
  void fn(undefined);
  return async () => name;
};

export const either = (a: Work, b: Work): Work => async (event) => (await a(event)) ?? b(event);
`;

const TRACING = `export declare function withSpan<T extends (...args: any[]) => unknown>(name: string, fn: T): T;`;

const program = (main: string): CallExpression[] => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  project.createSourceFile('/node_modules/@lending/tracing/package.json', '{"name":"@lending/tracing","types":"index.d.ts"}');
  project.createSourceFile('/node_modules/@lending/tracing/index.d.ts', TRACING);
  project.createSourceFile('/src/wrappers.ts', WRAPPERS);
  const file = project.createSourceFile('/src/main.ts', main);
  return file.getVariableDeclarations().map((declaration) => declaration.getInitializerIfKindOrThrow(SyntaxKind.CallExpression));
};

const HEADER = `
import { traced, withRetry, withTimeout, viaApply, identity, listFactory, eager, either } from './wrappers';
import { withSpan } from '@lending/tracing';
import { instrument } from '@lending/telemetry';
async function createLoan(event: unknown): Promise<unknown> { return event; }
async function renewLoan(event: unknown): Promise<unknown> { return event; }
`;

/** What the one call written in `main` wraps, by the text of the argument. */
const wraps = (main: string): { argument?: string; confidence?: string; why?: string } => {
  const [call] = program(`${HEADER}\nconst handler = ${main};`).slice(-1);
  const wrapped = wrappedBy(call as CallExpression);
  return wrapped === undefined
    ? {}
    : { argument: wrapped.argument.getText(), confidence: wrapped.confidence, ...(wrapped.why === undefined ? {} : { why: wrapped.why }) };
};

describe('a call handed exactly one function wraps it, wherever it sits', () => {
  it('a name, then the function', () => {
    expect(wraps(`traced('createLoan', createLoan)`)).toEqual({ argument: 'createLoan', confidence: 'static' });
  });

  it('options, then the function', () => {
    expect(wraps(`withRetry({ attempts: 3 }, createLoan)`)).toEqual({ argument: 'createLoan', confidence: 'static' });
  });

  it('the function, then options', () => {
    expect(wraps(`withTimeout(createLoan, { ms: 500 })`)).toEqual({ argument: 'createLoan', confidence: 'static' });
  });

  it('a function written in place', () => {
    expect(wraps(`traced('createLoan', async (event) => event)`)).toMatchObject({ argument: 'async (event) => event', confidence: 'static' });
  });

  it('through apply and through returning it as it is', () => {
    expect(wraps(`viaApply('createLoan', createLoan)`)).toMatchObject({ confidence: 'static' });
    expect(wraps(`identity('createLoan', createLoan)`)).toMatchObject({ confidence: 'static' });
  });
});

describe('static or heuristic follows whether the wrapper was read', () => {
  it('an installed package that says it hands back a function is static', () => {
    expect(wraps(`withSpan('createLoan', createLoan)`)).toEqual({ argument: 'createLoan', confidence: 'static' });
  });

  it('a package that is not installed is heuristic, and says which', () => {
    const read = wraps(`instrument(createLoan, { segment: 'loans' })`);
    expect(read).toMatchObject({ argument: 'createLoan', confidence: 'heuristic' });
    expect(read.why).toContain('@lending/telemetry, which is not installed');
  });
});

describe('what is not a wrapper', () => {
  it('two functions handed over', () => {
    expect(wraps(`either(createLoan, renewLoan)`)).toEqual({});
  });

  it('a factory of this repository that uses what it was handed rather than handing it on', () => {
    expect(wraps(`listFactory((event) => String(event))`)).toEqual({});
  });

  it('a function of this repository that calls what it was handed while it is built', () => {
    expect(wraps(`eager('createLoan', createLoan)`)).toEqual({});
  });

  it('a call handed no function at all', () => {
    expect(wraps(`withRetry({ attempts: 3 }, undefined as never)`)).toEqual({});
  });
});

describe('wrappers inside wrappers, inline and through a const', () => {
  it('inline, the outermost first', () => {
    const [call] = program(`${HEADER}\nconst handler = withRetry({ attempts: 2 }, traced('createLoan', createLoan));`).slice(-1);
    const { work, through } = unwrapWork(call as CallExpression);
    expect(work.getText()).toBe('createLoan');
    expect(through.map((step) => step.call.getExpression().getText())).toEqual(['withRetry', 'traced']);
  });

  it('through a const holding what a wrapper built', () => {
    const calls = program(`${HEADER}\nconst createLoanLogic = traced('createLoan', createLoan);\nconst handler = withTimeout(createLoanLogic, { ms: 500 });`);
    const { work, through } = unwrapWork(calls.at(-1) as CallExpression);
    expect(work.getText()).toBe('createLoan');
    expect(through).toHaveLength(2);
  });

  it('as unsure as the least sure wrapper on the way', () => {
    const [call] = program(`${HEADER}\nconst handler = traced('createLoan', instrument(createLoan, {}));`).slice(-1);
    const { work, through } = unwrapWork(call as CallExpression);
    expect(work.getText()).toBe('createLoan');
    expect(through.map((step) => step.confidence)).toEqual(['static', 'heuristic']);
  });
});
