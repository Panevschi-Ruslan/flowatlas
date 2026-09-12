import type { Confidence, TypeEntry } from '@flowatlas/core';
import type { CompactNode, FlowNode, GuardRef } from '@flowatlas/mcp';
import { dim, noPalette, plain, uncolored, type Paint, type RepoPalette } from './color.js';
import {
  ASCII_CROSSING,
  CONFIDENCE_MARK,
  CROSSING,
  guardPrefixFor,
  prefixFor,
  prefixWidth,
} from './prefixes.js';
import { serviceOf } from './scope.js';
import type { RenderOptions, SourceBlock } from './types.js';

/** Widest a label column gets before the paths stop being aligned to it. */
const MAX_LABEL_COLUMN = 72;

/** The count out of the walker's sentence, said the way the flags read. */
const CUT = /^(≥?)(\d+) more nodes/;

export const truncationLine = (message: string, ascii = false): string => {
  const lead = ascii ? '...' : '…';
  const match = CUT.exec(message);
  if (match === null) return `${lead} truncated: ${message}`;
  return `${lead} truncated: ${match[1] ?? ''}${match[2] ?? ''} more nodes (raise --max-nodes or lower --depth)`;
};

interface Row {
  left: string;
  /** Columns `left` occupies once its escape codes are discounted. */
  width: number;
  right: string;
}

/** L2 records where a guard lives; the shared type does not name the field yet. */
const guardLoc = (guard: GuardRef): string | undefined => (guard as { loc?: string }).loc;

const cell = (prefix: string): string => `${prefix}${' '.repeat(Math.max(3 - prefixWidth(prefix), 1))}`;

const location = (node: CompactNode): string => {
  if (node.loc === undefined) return '';
  const service = serviceOf(node);
  return service === undefined ? node.loc : `${service}/${node.loc}`;
};

const fieldLine = (name: string, type: string, optional: boolean): string =>
  `  ${name}${optional ? '?' : ''}: ${type}`;

const typeBlock = (id: string, entry: TypeEntry): string[] => {
  const lines = [`${id}  ${entry.name} (${entry.kind})`];
  for (const field of entry.fields ?? []) lines.push(fieldLine(field.name, field.type, field.optional));
  if (entry.members !== undefined && entry.members.length > 0) {
    lines.push(`  members: ${entry.members.join(' | ')}`);
  }
  return lines;
};

const sourceBlock = (id: string, block: SourceBlock): string[] => [
  `${id}  ${block.file}:${block.line}-${block.endLine}`,
  ...block.code.split('\n').map((line) => `  ${line}`),
];

/**
 * The walk as a person reads it.
 *
 * One line per node: how it was reached on the left, where it lives on the
 * right, and the repository it belongs to in colour, so a chain that leaves one
 * service for another cannot be mistaken for a local call. Detail was applied
 * before this ran, so a level that drops locations simply leaves the right-hand
 * column empty rather than being asked about here.
 */
export const renderTree = (tree: FlowNode, options: RenderOptions): string => {
  const ascii = options.ascii === true;
  const palette: RepoPalette = options.color === true ? (options.repoPalette ?? noPalette) : noPalette;
  const faint: Paint = options.color === true ? dim : plain;
  const rows: Row[] = [];

  const push = (indent: number, left: string, right: string): void => {
    const padded = `${'  '.repeat(indent)}${left}`;
    rows.push({ left: padded, width: uncolored(padded).length, right });
  };

  const label = (node: CompactNode, paint: Paint): string => {
    const prefix = cell(prefixFor(node.type, node.kind, ascii));
    return `${prefix}${paint(node.label)}`;
  };

  const visit = (flow: FlowNode, depth: number, parentService: string | undefined): void => {
    const { node } = flow;
    const service = serviceOf(node);
    const paint = palette.of(service);
    const crossed = service !== undefined && parentService !== undefined && service !== parentService;
    const crossing = crossed ? `${paint(`${ascii ? ASCII_CROSSING : CROSSING} ${service}`)} ` : '';

    const mark = flow.edge === undefined ? '' : CONFIDENCE_MARK[flow.edge.confidence as Confidence];
    const suffix = mark === '' || mark === undefined ? '' : ` ${faint(mark)}`;
    push(depth, `${crossing}${label(node, paint)}${suffix}`, location(node));

    for (const guard of flow.guards ?? []) {
      const at = guardLoc(guard);
      push(
        depth + 1,
        `${cell(guardPrefixFor(guard.kind, ascii))}${paint(guard.label)}`,
        at === undefined ? '' : `${service === undefined ? '' : `${service}/`}${at}`,
      );
    }

    for (const child of flow.children) visit(child, depth + 1, service ?? parentService);
  };

  visit(tree, 0, undefined);

  const column = Math.min(
    rows.reduce((widest, row) => (row.right === '' ? widest : Math.max(widest, row.width)), 0),
    MAX_LABEL_COLUMN,
  );
  const lines = rows.map((row) =>
    row.right === ''
      ? row.left
      : `${row.left}${' '.repeat(Math.max(column - row.width, 0))}  ${faint(row.right)}`,
  );

  if (options.truncated !== undefined) lines.push(truncationLine(options.truncated, ascii));

  const types = Object.entries(options.types ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (types.length > 0) {
    lines.push('', faint('--- types ---'));
    for (const [id, entry] of types) lines.push(...typeBlock(id, entry));
  }

  const source = Object.entries(options.source ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  if (source.length > 0) {
    lines.push('', faint('--- source ---'));
    for (const [id, block] of source) lines.push(...sourceBlock(id, block));
  }

  for (const line of options.footer ?? []) lines.push(line);
  return `${lines.join('\n')}\n`;
};
