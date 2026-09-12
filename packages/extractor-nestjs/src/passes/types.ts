import { definePass as defineExtractorPass, type ExtractorPass } from '@flowatlas/core';
import type { NestExtractContext } from '../context.js';

/** One step of extraction, over the context this extractor builds. */
export type NestExtractorPass = ExtractorPass<NestExtractContext>;

export const definePass = (
  name: string,
  run: (ctx: NestExtractContext) => void,
): NestExtractorPass => defineExtractorPass(name, run);
