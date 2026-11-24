import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphNode } from '@flowatlas/core';
import { endOfDeclaration } from '../tools/source.js';

/**
 * Where the code a row names ends (P393, after the research's P-16), so a
 * Read goes straight to `line`-`endLine` instead of a second call to find
 * the end. The graph records where a declaration begins; its end is read from
 * the checkout at answer time, by the same brace count get_source cuts a
 * symbol with, so the two agree. Said only for declarations that hold a body
 * (a method, a function, a class, a component, a handler), only where the
 * repository is checked out here, and only where the count met a brace and
 * ended past the first line: never guessed.
 */

/** The node types whose recorded line starts a declaration with a body. */
const DECLARATION_TYPES: ReadonlySet<string> = new Set([
  'method',
  'function',
  'provider',
  'ui_component',
  'consumer',
  'module',
  'guard',
  'interceptor',
  'pipe',
  'middleware',
]);

/** The most files one answer reads for end lines; past it, rows go without one. */
const MOST_FILES = 200;

/** The most lines a declaration is counted over before it is said to have no end line. */
const MOST_LINES = 1500;

/** What end lines are read with: where each repository is checked out. */
export interface EndLineSource {
  repoDir?: (service: string) => string | undefined;
}

/** The end line of a node's declaration, or undefined where it is not read; files read once per reader. */
export type EndLineOf = (node: Pick<GraphNode, 'type' | 'repo' | 'file' | 'line'> | undefined) => number | undefined;

export const endLineReader = (source: EndLineSource): EndLineOf => {
  const files = new Map<string, readonly string[] | null>();
  const linesOf = (repo: string, file: string): readonly string[] | null => {
    const key = `${repo}\u0000${file}`;
    const known = files.get(key);
    if (known !== undefined) return known;
    if (files.size >= MOST_FILES) return null;
    const root = source.repoDir?.(repo);
    const path = root === undefined ? undefined : join(root, file);
    let lines: readonly string[] | null = null;
    if (path !== undefined && existsSync(path)) {
      try {
        lines = readFileSync(path, 'utf8').split(/\r?\n/);
      } catch {
        lines = null;
      }
    }
    files.set(key, lines);
    return lines;
  };
  return (node) => {
    if (node === undefined || !DECLARATION_TYPES.has(node.type) || node.file === undefined || node.line === undefined || node.line < 1) return undefined;
    const lines = linesOf(node.repo, node.file);
    if (lines === null || node.line > lines.length) return undefined;
    const start = node.line - 1;
    const end = endOfDeclaration(lines, start, MOST_LINES);
    if (end <= start || end >= lines.length || end >= start + MOST_LINES) return undefined;
    // A declaration with no body (a one-line arrow) has no brace to end at.
    if (!lines.slice(start, end + 1).some((line) => line.includes('{'))) return undefined;
    return end + 1;
  };
};

/** Every row of a tree (get_flow's) with its end line beside its `loc`, where one is read; a node met again is left as it is. */
export const markEndLines = <T extends { node: { id: string; ref?: true; loc?: string; endLine?: number }; children: readonly T[] }>(
  root: T,
  nodeOf: (id: string) => GraphNode | undefined,
  endOf: EndLineOf,
): void => {
  const queue: T[] = [root];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.node.ref !== true) {
      const marked = withEndLine(item.node, nodeOf(item.node.id), endOf);
      if (marked.endLine !== undefined) item.node.endLine = marked.endLine;
    }
    queue.push(...item.children);
  }
};

/** A row with `endLine` beside its `loc`, where the row's code is a declaration whose end was read. */
export const withEndLine = <T extends { id?: string; loc?: string }>(row: T, node: Parameters<EndLineOf>[0], endOf: EndLineOf): T => {
  if (typeof row.loc !== 'string' || !/:\d+$/.test(row.loc) || 'endLine' in row) return row;
  const endLine = endOf(node);
  return endLine === undefined ? row : { ...row, endLine };
};
