import { recordSignatures } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import { definePass } from './types.js';

/** Every function this reader indexed, by the id its node has. */
function* functionsOf(ctx: ReactExtractContext): Generator<readonly [string, TsNode]> {
  for (const indexed of ctx.functions.all()) yield [indexed.id, indexed.fn.declaration];
}

/**
 * What each component, hook and function takes and gives back.
 *
 * A component's one parameter is its props, so its signature is what a screen
 * is handed. Last, so that every edge into a function is drawn before its types
 * are written on it.
 */
export const signaturesPass = definePass('types', (ctx) => {
  recordSignatures(ctx.builder, ctx.types, functionsOf(ctx));
});
