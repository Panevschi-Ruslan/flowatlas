import { definePass as defineExtractorPass, type ExtractorPass } from '@flowatlas/core';
import type { ReactExtractContext } from '../context.js';

/** One step of extraction, over the context this extractor builds. */
export type ReactExtractorPass = ExtractorPass<ReactExtractContext>;

export const definePass = (
  name: string,
  run: (ctx: ReactExtractContext) => void,
): ReactExtractorPass => defineExtractorPass(name, run);
