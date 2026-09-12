import { definePass as defineExtractorPass, type ExtractorPass } from '@flowatlas/core';
import type { AngularExtractContext } from '../context.js';

/** One step of extraction, over the context this extractor builds. */
export type AngularExtractorPass = ExtractorPass<AngularExtractContext>;

export const definePass = (
  name: string,
  run: (ctx: AngularExtractContext) => void,
): AngularExtractorPass => defineExtractorPass(name, run);
