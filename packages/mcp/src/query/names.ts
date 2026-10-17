import type { GraphNode } from '@flowatlas/core';

/**
 * Names close to what was asked for (P94).
 *
 * One place for how a half-remembered name finds what it meant: the tools
 * that resolve a name, and the errors that say "no such thing" and name the
 * nearest, all rank the same way, so a suggestion an error makes is a name
 * the next call accepts.
 */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The initials of a camel-cased or separated name: `ocs` finds
 * `OrderCreationService`, which is how someone types when they half remember it.
 */
const initialsOf = (text: string): string =>
  (text.match(/[A-Z]|(?<=[^A-Za-z0-9])[a-z]/g) ?? []).join('').toLowerCase();

export interface Ranked {
  node: GraphNode;
  score: number;
}

/** Fuzzy match: the label exactly, as a prefix, inside it, by initials, then inside the id. */
export const rankMatches = (nodes: readonly GraphNode[], query: string): Ranked[] => {
  const wanted = query.toLowerCase();
  const ranked: Ranked[] = [];
  for (const node of nodes) {
    const label = node.label.toLowerCase();
    const id = node.id.toLowerCase();
    if (label === wanted) ranked.push({ node, score: 0 });
    else if (label.startsWith(wanted)) ranked.push({ node, score: 1 });
    else if (label.includes(wanted)) ranked.push({ node, score: 2 });
    else if (initialsOf(node.label).includes(wanted)) ranked.push({ node, score: 3 });
    else if (id.includes(wanted)) ranked.push({ node, score: 4 });
  }
  return ranked.sort((a, b) => a.score - b.score || a.node.label.length - b.node.label.length || cmp(a.node.id, b.node.id));
};

/** Levenshtein distance, on two rows: the cost of turning one spelling into the other. */
export const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

/**
 * How far a misspelling may be from a name and still be offered: two edits,
 * or a third of the name, whichever is more. Past that a suggestion is noise.
 */
const nearEnough = (text: string): number => Math.max(2, Math.floor(text.length / 3));

/**
 * The `n` words nearest to `text`, nearest first: the ones that contain it,
 * then by edit distance within {@link nearEnough}. Ties by name.
 */
export const nearWords = (pool: readonly string[], text: string, n: number): string[] => {
  const wanted = text.trim().toLowerCase();
  if (wanted === '') return [];
  const limit = nearEnough(wanted);
  return [...new Set(pool)]
    .map((word) => {
      const lower = word.toLowerCase();
      const distance = lower.includes(wanted) || wanted.includes(lower) ? 0 : editDistance(lower, wanted);
      return { word, distance };
    })
    .filter((item) => item.distance <= limit)
    .sort((a, b) => a.distance - b.distance || a.word.length - b.word.length || cmp(a.word, b.word))
    .slice(0, n)
    .map((item) => item.word);
};

/**
 * The `n` nodes nearest to `text`: the fuzzy matches first, as a name lookup
 * ranks them, then labels a few edits away, so a typo still finds its name.
 */
export const nearNames = (pool: readonly GraphNode[], text: string, n: number): GraphNode[] => {
  const wanted = text.trim();
  if (wanted === '' || n <= 0) return [];
  const found = rankMatches(pool, wanted).slice(0, n).map((match) => match.node);
  if (found.length >= n) return found;
  const taken = new Set(found.map((node) => node.id));
  const lower = wanted.toLowerCase();
  const limit = nearEnough(lower);
  const close = pool
    .filter((node) => !taken.has(node.id) && Math.abs(node.label.length - lower.length) <= limit)
    .map((node) => ({ node, distance: editDistance(node.label.toLowerCase(), lower) }))
    .filter((item) => item.distance <= limit)
    .sort((a, b) => a.distance - b.distance || cmp(a.node.id, b.node.id))
    .slice(0, n - found.length)
    .map((item) => item.node);
  return [...found, ...close];
};
