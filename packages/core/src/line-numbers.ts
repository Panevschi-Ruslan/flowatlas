import type { Node, SourceFile } from 'ts-morph';

/**
 * Line and column numbers, the ones ts-morph gives, found by a lookup (P79, P123).
 *
 * `getStartLineNumber()` and `getLineAndColumnAtPos()` count the newlines from
 * the top of the file on every call, so a pass that asks once per node of a
 * large file pays for a read of the file each time: calls x file length. These
 * list a file's line breaks once per parsed file and binary-search them, and
 * give the same numbers: a line is one more than the `\n`s before the
 * position, a column one more than its distance from the last `\n` or `\r`
 * before it, as ts-morph counts both.
 */

interface Breaks {
  /** Every `\n`, which is what a line number counts. */
  readonly newlines: readonly number[];
  /** Every `\n` and `\r`, which is where a column counts from. */
  readonly starts: readonly number[];
}

/**
 * Keyed by the compiler's node for the file rather than by ts-morph's wrapper:
 * a watch refreshes a changed file in place, which keeps the wrapper and
 * replaces the compiler node. A file removed or refreshed leaves the old node
 * unreachable, and its entry goes with it.
 */
const BREAKS = new WeakMap<object, Breaks>();

const breaksOf = (source: SourceFile): Breaks => {
  const key = source.compilerNode;
  let breaks = BREAKS.get(key);
  if (breaks === undefined) {
    const text = source.getFullText();
    const newlines: number[] = [];
    const starts: number[] = [];
    for (let at = 0; at < text.length; at += 1) {
      const code = text.charCodeAt(at);
      if (code === 10) newlines.push(at);
      if (code === 10 || code === 13) starts.push(at);
    }
    breaks = { newlines, starts };
    BREAKS.set(key, breaks);
  }
  return breaks;
};

/** How many of the sorted positions are before `pos`. */
const countBefore = (sorted: readonly number[], pos: number): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? Number.POSITIVE_INFINITY) < pos) low = middle + 1;
    else high = middle;
  }
  return low;
};

/** The 1-based line and column of a position in a file: `getLineAndColumnAtPos(pos)`. */
export const lineAndColumnAt = (source: SourceFile, pos: number): { line: number; column: number } => {
  const { newlines, starts } = breaksOf(source);
  const before = countBefore(starts, pos);
  const lineStart = before === 0 ? 0 : (starts[before - 1] ?? -1) + 1;
  return { line: countBefore(newlines, pos) + 1, column: pos - lineStart + 1 };
};

/** The 1-based line a node starts on: `getStartLineNumber()`. */
export const startLineOf = (node: Node): number =>
  countBefore(breaksOf(node.getSourceFile()).newlines, node.getStart()) + 1;
