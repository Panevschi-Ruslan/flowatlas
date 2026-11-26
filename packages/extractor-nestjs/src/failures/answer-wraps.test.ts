import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { answerShapeOf } from './answer-wraps.js';

/**
 * What an interceptor's `intercept` does to the answer on its way out (P400):
 * nothing, an envelope a `map` builds around it, or why that is not read.
 */
const SOURCE = `
import { map, tap, switchMap, catchError, of } from 'rxjs';
declare const next: { handle(): { pipe(...ops: unknown[]): unknown } };

export class Interceptors {
  envelope() { return next.handle().pipe(map((data) => ({ success: true, data }))); }
  shorthand() { return next.handle().pipe(map((result) => ({ ok: true, result }))); }
  block() { return next.handle().pipe(map((value) => { return { payload: value, at: Date.now() }; })); }
  untouched() { return next.handle().pipe(tap(() => undefined), catchError(() => of(null))); }
  same() { return next.handle().pipe(map((value) => value)); }
  helper() { return next.handle().pipe(map((value) => this.shape(value))); }
  spread() { return next.handle().pipe(map((value) => ({ ...value, at: 1 }))); }
  swapped() { return next.handle().pipe(switchMap((value) => of(value))); }
  shape(value: unknown) { return value; }
}
`;

const body = (name: string) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const file = project.createSourceFile('interceptors.ts', SOURCE);
  return file.getClassOrThrow('Interceptors').getMethodOrThrow(name).getBodyOrThrow();
};

describe('what an interceptor does to the answer (P400)', () => {
  it('reads an envelope a map builds around the answer, by property or shorthand, in an arrow or a block', () => {
    expect(answerShapeOf(body('envelope'))).toEqual({ envelope: { fields: ['data', 'success'], into: 'data' } });
    expect(answerShapeOf(body('shorthand'))).toEqual({ envelope: { fields: ['ok', 'result'], into: 'result' } });
    expect(answerShapeOf(body('block'))).toEqual({ envelope: { fields: ['at', 'payload'], into: 'payload' } });
  });

  it('says nothing where the answer goes on as it is', () => {
    expect(answerShapeOf(body('untouched'))).toBeUndefined();
    expect(answerShapeOf(body('same'))).toBeUndefined();
  });

  it('says why where what reaches the client is worked out when the code runs', () => {
    expect(answerShapeOf(body('helper'))).toEqual({ unread: 'its map(...) answers this.shape(value), not an object written out' });
    expect(answerShapeOf(body('spread'))).toEqual({ unread: 'its map(...) answers an object with a spread or a method' });
    expect(answerShapeOf(body('swapped'))).toEqual({ unread: "switchMap(...) puts another value in the answer's place" });
  });
});
