import type { Unresolved } from '@flowatlas/core';
import { editIndexProblem } from '../agents/edit-index.js';
import { EDITS_FILE } from '../agents/edit-match.js';

/**
 * The reason a row about the edit hook's index carries (P396): `edits.json`
 * missing beside the graph, older than it, or recorded by the build as not
 * written, with why. The hook reads that index and nothing else, so without it
 * the hook says nothing after an edit and nothing said so: a real
 * five-repository project built with no index and no word. Asked when `doctor`
 * runs, like a checkout that moved; info, so it decides no exit code and moves
 * no baseline.
 */
export const EDIT_INDEX_REASON = 'edit-index-unwritten';

/** One row where the edit index beside the graph is not the one its build should have written. */
export const editIndexRows = (outputDir: string | undefined, builtAt: string | undefined): Unresolved[] => {
  if (outputDir === undefined) return [];
  const problem = editIndexProblem(outputDir, builtAt);
  if (problem === undefined) return [];
  return [
    {
      file: EDITS_FILE,
      line: 1,
      reason: EDIT_INDEX_REASON,
      level: 'info',
      symbol: EDITS_FILE,
      message: `the edit hook's index: ${problem}`,
      hint: 'Run flowatlas build again; the summary says why the index could not be written, and the edit hook stays silent until it is.',
    },
  ];
};
