import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { placedFunction, placeOf } from './functions.js';

const firstFunctionIn = (text: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('/repo/src/a.ts', text);
  const fn =
    file.getFirstDescendantByKind(SyntaxKind.ArrowFunction) ??
    file.getFirstDescendantByKind(SyntaxKind.FunctionExpression);
  if (fn === undefined) throw new Error('no function in the sample');
  return fn;
};

describe('placeOf', () => {
  it('names a function handed to a method by the value it is kept under and the method', () => {
    const fn = firstFunctionIn('export const bookingsProcedure = authed.input(x).use(async ({ ctx }) => ctx);');
    expect(placeOf(fn)).toBe('bookingsProcedure.use');
    expect(placedFunction(fn).name).toBe('bookingsProcedure.use@1');
  });

  it('names one handed to a bare call by the call alone', () => {
    expect(placeOf(firstFunctionIn("describe('orders', () => {});"))).toBe('describe');
  });

  it('names one set as a member of an object by the member', () => {
    expect(placeOf(firstFunctionIn('export default config({ setup: function () {} });'))).toBe('default.setup');
  });

  it('says where it is when nothing names it', () => {
    expect(placeOf(firstFunctionIn('(async () => {})();'))).toBe('(module)');
  });
});
