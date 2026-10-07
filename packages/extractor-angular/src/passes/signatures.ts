import { methodsOfClass, recordSignatures, type ClassMethod } from '@flowatlas/core';
import type { AngularExtractContext } from '../context.js';
import { definePass } from './types.js';

/** Every method of every class this reader indexed, by the id its node has. */
function* methodsOf(ctx: AngularExtractContext): Generator<readonly [string, ClassMethod]> {
  for (const indexed of ctx.classes.all()) {
    for (const method of methodsOfClass(indexed.declaration)) {
      const id = ctx.methodIdOf(method);
      if (id !== undefined) yield [id, method];
    }
  }
}

/**
 * What each method takes and gives back.
 *
 * Last, so that every edge into a method - a call from another one, and a
 * template event bound to it - is drawn before the method's types are written
 * on it. A template event then says what it hands its handler.
 */
export const signaturesPass = definePass('types', (ctx) => {
  recordSignatures(ctx.builder, ctx.types, methodsOf(ctx));
});
