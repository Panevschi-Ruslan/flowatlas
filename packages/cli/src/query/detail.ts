import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DetailLevel, TypeEntry } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { endOfDeclaration, expandType, flatten, type FlowNode, type SourceRoots } from '@flowatlas/mcp';
import type { SourceBlock } from '../render/types.js';

/** How deep a type's nesting is followed, per the plan's cap. */
const TYPE_FANOUT = 500;

export const TYPE_DEPTH = 3;

const TYPE_ID = /type:[^\s"',;()[\]{}<>|&]+/g;

/** Every registry id a tree names, whether on an edge or inside metadata. */
const mentionedTypes = (tree: FlowNode): string[] => {
  const found = new Set<string>();
  for (const flow of flatten(tree)) {
    for (const id of flow.edge?.params ?? []) {
      for (const match of id.matchAll(TYPE_ID)) found.add(match[0]);
    }
    for (const match of (flow.edge?.returns ?? '').matchAll(TYPE_ID)) found.add(match[0]);
    if (flow.node.meta !== undefined) {
      for (const match of JSON.stringify(flow.node.meta).matchAll(TYPE_ID)) found.add(match[0]);
    }
  }
  return [...found].sort();
};

/**
 * The types a walk touches, expanded once for the whole tree.
 *
 * Levels above one promise structures rather than ids, and a structure is the
 * same wherever it is mentioned, so it is fetched once and printed once instead
 * of being inlined at every edge that carries it (I5).
 */
export const collectTypes = (
  db: GraphDb,
  tree: FlowNode,
  detail: DetailLevel,
): Record<string, TypeEntry> => {
  if (detail < 2) return {};
  const collected: Record<string, TypeEntry> = {};
  for (const id of mentionedTypes(tree)) {
    const entry = db.type(id);
    if (entry === undefined) continue;
    collected[id] = entry;
    // The terminal renderer bounds what it prints; this collects what the
    // tree mentions, so the ceiling here is only there to stop a cycle of
    // shapes running away.
    for (const [nestedId, nested] of Object.entries(
      expandType(db, id, TYPE_DEPTH, TYPE_FANOUT).nested,
    )) {
      collected[nestedId] ??= nested;
    }
  }
  // Sorted, because a record printed in insertion order would change with the
  // shape of the walk rather than with the graph.
  return Object.fromEntries(Object.entries(collected).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/**
 * The code behind each node of a walk.
 *
 * The graph records where a declaration starts and not where it ends, so the
 * end is counted from the braces, exactly as the server does it for one symbol
 * at a time. A node whose repository is not configured is skipped rather than
 * guessed at.
 */
export const collectSource = (
  db: GraphDb,
  roots: SourceRoots,
  tree: FlowNode,
  detail: DetailLevel,
): Record<string, SourceBlock> => {
  if (detail < 3) return {};
  const blocks: Record<string, SourceBlock> = {};
  const files = new Map<string, string[]>();

  for (const flow of [...flatten(tree)].sort((a, b) => (a.node.id < b.node.id ? -1 : 1))) {
    if (flow.node.ref === true || blocks[flow.node.id] !== undefined) continue;
    const node = db.node(flow.node.id);
    if (node?.file === undefined) continue;
    const root = roots.repoDir(node.repo);
    if (root === undefined) continue;

    const path = join(root, node.file);
    let lines = files.get(path);
    if (lines === undefined) {
      if (!existsSync(path)) continue;
      lines = readFileSync(path, 'utf8').split('\n');
      files.set(path, lines);
    }

    const start = Math.max((node.line ?? 1) - 1, 0);
    const end = endOfDeclaration(lines, start);
    blocks[flow.node.id] = {
      file: node.file,
      line: start + 1,
      endLine: end + 1,
      code: lines.slice(start, end + 1).join('\n'),
    };
  }
  return blocks;
};
