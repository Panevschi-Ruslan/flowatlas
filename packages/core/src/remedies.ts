/**
 * How each kind of row is closed (P122): the one table every surface reads.
 *
 * The table itself lives in `prompt-text.js`, beside the renderer that says it,
 * because the page inlines that file and can import nothing; this is the typed
 * face of it for the code that can. A reason maps to the ways that close it -
 * linking the repository that answers it, naming a setting, a pattern, a shape
 * file, an annotation - and every row can be accepted besides. A reason no way
 * is listed for is closed by the advice its places carry (`advice`).
 */
import { PROMPT_REMEDY_REASONS, promptRemediesOf, promptRemedyLines, type PromptRemedy } from './prompt-text.js';

/** Every reason the table names, to the ways that close it, in the table's order. */
export const REMEDIES: ReadonlyMap<string, readonly PromptRemedy[]> = (() => {
  const out = new Map<string, PromptRemedy[]>();
  for (const [remedy, reasons] of Object.entries(PROMPT_REMEDY_REASONS) as Array<[PromptRemedy, readonly string[]]>) {
    for (const reason of reasons) out.set(reason, [...(out.get(reason) ?? []), remedy]);
  }
  return out;
})();

/** The ways one reason is closed; `advice` alone for a reason the table does not name. */
export const remediesOf = (reason: string): PromptRemedy[] => promptRemediesOf(reason);

/** The "How to close it" lines of a gap id, as every surface writes them; `missing` names the repository probably missing. */
export const remedyLinesOf = (gapId: string, missing?: string): string[] =>
  promptRemedyLines({ id: gapId, check: { places: [], ...(missing === undefined ? {} : { missing }) } });
