/**
 * The names a Markdown page mentions (P234): what decision records, READMEs
 * and runbooks say in code, which is how an author writes "this exact thing".
 *
 * A code span (`` `POST /orders/:id` ``) and each line of a fence with no
 * language or `text` are read; prose never is, and neither is a fence tagged
 * with a language, whose names are an example's, not claims about this
 * project (D1, D2). What lies inside a flowatlas block's generated content is
 * the block's, and is skipped. Each mention carries the heading above it, so a
 * reader picks the right one of many. Whether it names a node is the graph's
 * to say; this only finds the text. Pure.
 */
export interface Mention {
  text: string;
  /** 1-based. */
  line: number;
  /** The nearest heading above it, as written. */
  heading?: string;
}

/** Shorter than this, a span names too much to be a link. */
export const MIN_MENTION = 4;

/** Fences whose lines are names rather than code. */
const PLAIN_FENCES: ReadonlySet<string> = new Set(['', 'text', 'txt', 'plain']);

export const mentionsOf = (markdown: string): Mention[] => {
  const mentions: Mention[] = [];
  const lines = markdown.split(/\r?\n/);
  let heading: string | undefined;
  let fence: { marker: string; plain: boolean } | undefined;
  let inBlock = false;
  lines.forEach((raw, index) => {
    const line = index + 1;
    const add = (text: string): void => {
      const trimmed = text.trim();
      if (trimmed.length >= MIN_MENTION && !/\s{2,}/.test(trimmed)) mentions.push({ text: trimmed, line, ...(heading === undefined ? {} : { heading }) });
    };
    const fenceOpen = /^\s*(```+|~~~+)\s*([\w-]*)/.exec(raw);
    if (fence !== undefined) {
      if (fenceOpen !== null && fenceOpen[1]!.startsWith(fence.marker[0]!) && fenceOpen[1]!.length >= fence.marker.length && fenceOpen[2] === '') fence = undefined;
      else if (fence.plain && !inBlock) add(raw);
      return;
    }
    if (fenceOpen !== null) {
      fence = { marker: fenceOpen[1]!, plain: PLAIN_FENCES.has((fenceOpen[2] ?? '').toLowerCase()) };
      return;
    }
    // A block's generated content links its own names already (P120).
    if (/<!--\s*flowatlas:(flow|channel|symbol|overview)\b/.test(raw)) inBlock = true;
    if (/<!--\s*\/flowatlas:/.test(raw)) {
      inBlock = false;
      return;
    }
    if (inBlock) return;
    const head = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (head !== null) {
      heading = head[1];
      return;
    }
    for (const span of raw.matchAll(/(`+)([^`]+?)\1(?!`)/g)) add(span[2] as string);
  });
  return mentions;
};
