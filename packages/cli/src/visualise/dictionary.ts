/**
 * The page's one rule for a repeated string (P84): every distinct value once,
 * sorted, and the position of each to ship in its place.
 *
 * Sorted rather than in order of first use, so two packs of one build are the
 * same bytes whatever order the values were met in.
 */
export const dictionary = (values: Iterable<string>): [string[], Map<string, number>] => {
  const list = [...new Set(values)].sort();
  return [list, new Map(list.map((value, index) => [value, index]))];
};

/** A shipped value: its position in the block's dictionary, or the value itself. */
export type Word = number | string;

/**
 * The same rule for a block whose values mostly do not repeat - a log line's
 * template, a span's service - where a dictionary of everything would cost
 * more than it saves: only a value whose position, every time it is used, and
 * its one place in the list cost less than writing it out every time is
 * listed, and the rest ship as they are. Nothing is listed unless the saving
 * also pays for the list's own name (`key`) in the pack, so no block is ever
 * larger than its values written out.
 *
 * `word` gives what to ship for a value; a reader tells the two apart by type.
 */
export const wordsOf = (values: readonly string[], key: string): { list: string[]; word: (value: string) => Word } => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const repeated = [...counts].filter(([, count]) => count > 1);
  // The widest position the list could need, so a value judged to pay does.
  const digits = String(Math.max(repeated.length - 1, 0)).length;
  const savingOf = (value: string, count: number): number => {
    const length = JSON.stringify(value).length;
    return count * length - (length + 1 + count * digits);
  };
  const paying = repeated.filter(([value, count]) => savingOf(value, count) > 0);
  const saved = paying.reduce((sum, [value, count]) => sum + savingOf(value, count), 0);
  // `,"key":[]` is what the list costs before it holds anything.
  if (saved <= key.length + 6) return { list: [], word: (value) => value };
  const [list, at] = dictionary(paying.map(([value]) => value));
  return { list, word: (value) => at.get(value) ?? value };
};
