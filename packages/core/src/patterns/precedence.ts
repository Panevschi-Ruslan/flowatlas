import type { Unresolved } from '../model/graph.js';
import { ruleIdOf } from './compile.js';

/**
 * Which of several descriptions that match one call is read (P121).
 *
 * A description written by hand - one of the tool's own or one in
 * configuration - wins over a compiled pattern, which is then said to be
 * shadowed: a pattern that matches what is already read is nearly always a
 * mistake about which type a call is made on, and a second reading of the
 * call would draw its edges twice. Two patterns on one call are ambiguous and
 * neither is read, because nothing says which of them the author meant.
 */
export interface Precedence<T> {
  /**
   * The descriptions to read: every written one that matched, in order, or
   * the one pattern that did; none where patterns alone matched and disagree.
   */
  readonly chosen: readonly T[];
  /** Rules that matched and were passed over for a written description. */
  readonly shadowed: readonly string[];
  /** Rules that matched together, none written by hand, so none is read. */
  readonly ambiguous: readonly string[];
}

const distinct = (ids: readonly (string | undefined)[]): string[] => [...new Set(ids.filter((id): id is string => id !== undefined))];

export const precedenceOf = <T>(matches: readonly T[], describedBy: (match: T) => string | undefined): Precedence<T> => {
  const written = matches.filter((match) => describedBy(match) === undefined);
  const compiled = matches.filter((match) => describedBy(match) !== undefined);
  if (written.length > 0) {
    return { chosen: written, shadowed: distinct(compiled.map(describedBy)), ambiguous: [] };
  }
  const ids = distinct(compiled.map(describedBy));
  if (ids.length > 1) return { chosen: [], shadowed: [], ambiguous: ids };
  return { chosen: compiled.slice(0, 1), shadowed: [], ambiguous: [] };
};

/** The rule ids of `pattern:<id>` values, for a row. */
const idsOf = (values: readonly string[]): string[] => values.map((value) => ruleIdOf(value) ?? value);

/**
 * The rows a choice leaves at a call: `pattern-shadowed` (info) for each rule
 * a written description won over, `pattern-ambiguous` for rules that matched
 * together. `by` names what was read instead, for the shadowed row.
 */
export const precedenceRows = (
  precedence: Precedence<unknown>,
  at: { readonly file: string; readonly line: number; readonly symbol: string },
  by: string | undefined,
): Unresolved[] => {
  const rows: Unresolved[] = [];
  for (const rule of idsOf(precedence.shadowed)) {
    rows.push({
      file: at.file,
      line: at.line,
      reason: 'pattern-shadowed',
      level: 'info',
      // One row per rule and call, never folded: which rule is the point of it.
      sites: 1,
      symbol: at.symbol,
      message: `the rule ${rule} matches this call and is not read: ${by ?? 'a written description'} reads it already`,
      hint: 'A written description wins over a pattern. Nothing to do if the call is read right; otherwise check the rule\'s on.receiverType, or remove it.',
      meta: { rule, ...(by === undefined ? {} : { by }) },
    });
  }
  if (precedence.ambiguous.length > 0) {
    const rules = idsOf(precedence.ambiguous);
    rows.push({
      file: at.file,
      line: at.line,
      reason: 'pattern-ambiguous',
      symbol: at.symbol,
      message: `the rules ${rules.join(', ')} all match this call, so none of them is read`,
      hint: 'Two patterns describe one call. Narrow one of them - a receiver type, a literal the call writes - or remove one; flowatlas patterns explain shows how far each matched.',
      meta: { rules },
    });
  }
  return rows;
};
