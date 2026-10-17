/**
 * A tour: a flow as a numbered walkthrough, one line per step, with a slot
 * under each for the author's note (P120 D4).
 *
 * The note is the human part of the page, so a regeneration must never lose
 * it: each step line carries its key (`<!-- step key="…" -->`, the node id
 * without a position), the note is whatever the author wrote under that line,
 * and the next regeneration puts it back under the step with the same key,
 * wherever the step now is. A note whose step left the flow is kept at the
 * end under "Orphaned notes" with the line it was written under, never
 * deleted; if the step comes back, so does the note.
 */
import { encodeAttribute } from './blocks.js';

/** The empty slot a step gets until somebody writes under it. */
export const NOTE_SLOT = '<!-- note -->';

/** Ends the steps, so nothing the tool writes after them is read as the last step's note. */
export const STEPS_END = '<!-- /steps -->';

/** What heads the notes whose step is gone. */
export const ORPHANED_HEADING = '**Orphaned notes** (their step is no longer in this flow):';

const STEP_KEY = /<!-- step key="([^"]*)" -->\s*$/;

const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** One step of a tour as it is drawn: its key and the line's text, without the number. */
export interface TourStep {
  key: string;
  text: string;
}

/** A note as the author left it: the lines under a step, and the step line it was under. */
export interface TourNote {
  /** The step line's text, without its number, list mark or key. */
  text: string;
  lines: string[];
}

/** `3. text <!-- step key="k" -->` or `- text <!-- step key="k" -->` → the text. */
const textOf = (line: string): string =>
  line
    .replace(STEP_KEY, '')
    .replace(/^\s*(?:\d+\.|-)\s+/, '')
    .trimEnd();

/**
 * The notes in a tour's content, by step key: every line under a keyed step
 * line up to the next one, the slot placeholder left out, blank lines at the
 * end trimmed. A step with nothing written under it has no note.
 */
export const tourNotesOf = (content: string): Map<string, TourNote> => {
  const notes = new Map<string, TourNote>();
  let current: { key: string; note: TourNote } | undefined;
  const settle = (): void => {
    if (current === undefined) return;
    const lines = [...current.note.lines];
    while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop();
    while (lines.length > 0 && (lines[0] as string).trim() === '') lines.shift();
    if (lines.length > 0 && !notes.has(current.key)) notes.set(current.key, { text: current.note.text, lines });
    current = undefined;
  };
  for (const line of content.split(/\r?\n/)) {
    const keyed = STEP_KEY.exec(line);
    if (keyed !== null) {
      settle();
      current = { key: decode(keyed[1] as string), note: { text: textOf(line), lines: [] } };
      continue;
    }
    if (line.trim() === ORPHANED_HEADING || line.trim() === STEPS_END) {
      settle();
      continue;
    }
    if (current === undefined || line.trim() === NOTE_SLOT) continue;
    current.note.lines.push(line);
  }
  settle();
  return notes;
};

const keyMark = (key: string): string => `<!-- step key="${encodeAttribute(key)}" -->`;

/**
 * The tour's content: each step numbered, its note under it or an empty slot,
 * then the notes no step took. Returns the orphaned keys too, so the command
 * can say which notes lost their step.
 */
export const renderTour = (
  steps: readonly TourStep[],
  notes: ReadonlyMap<string, TourNote>,
  trailer: readonly string[] = [],
): { text: string; orphaned: string[] } => {
  const lines: string[] = [];
  const taken = new Set<string>();
  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.text} ${keyMark(step.key)}`);
    const note = notes.get(step.key);
    if (note === undefined) lines.push(`   ${NOTE_SLOT}`);
    else {
      lines.push(...note.lines);
      taken.add(step.key);
    }
  });
  const orphaned = [...notes.keys()].filter((key) => !taken.has(key)).sort();
  lines.push(STEPS_END);
  if (trailer.length > 0) lines.push('', ...trailer);
  if (orphaned.length > 0) {
    lines.push('', ORPHANED_HEADING, '');
    for (const key of orphaned) {
      const note = notes.get(key) as TourNote;
      lines.push(`- ${note.text} ${keyMark(key)}`, ...note.lines);
    }
  }
  return { text: `${lines.join('\n')}\n`, orphaned };
};
