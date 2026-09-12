import type { Confidence, EntryKind, NodeType } from '@flowatlas/core';

/**
 * One glyph per kind of node, so a tree can be read down its left edge.
 *
 * The five the plan names are fixed: a call arrow, a bolt for anything on a
 * channel, a filled box for the data layer, a rising arrow for a request
 * leaving the process, and a shield for whatever runs before a handler.
 */
export const NODE_PREFIX: Record<NodeType, string> = {
  repo: '▤',
  service: '▤',
  module: '▤',
  entry: '◆',
  provider: '⬡',
  method: '→',
  function: '→',
  guard: '🛡',
  interceptor: '🛡',
  pipe: '🛡',
  middleware: '🛡',
  db_query: '▣',
  table: '▤',
  cache_op: '▣',
  channel: '⚡',
  producer: '⚡',
  consumer: '⚡',
  http_out: '↗',
  external_api: '↗',
  ui_component: '▢',
  ui_action: '▢',
  ui_api_call: '↗',
  config_key: '⚙',
};

/** The same table for a terminal whose font has none of the above. */
export const ASCII_PREFIX: Record<NodeType, string> = {
  repo: '=',
  service: '=',
  module: '=',
  entry: '@',
  provider: '*',
  method: '->',
  function: '->',
  guard: '!',
  interceptor: '!',
  pipe: '!',
  middleware: '!',
  db_query: '[]',
  table: '#',
  cache_op: '[]',
  channel: '~',
  producer: '~',
  consumer: '~',
  http_out: '^',
  external_api: '^',
  ui_component: '%',
  ui_action: '%',
  ui_api_call: '^',
  config_key: '$',
};

/**
 * The only place a kind of entry changes anything.
 *
 * A bot callback and a route are the same node walked by the same code; they
 * differ by one glyph, and this is it.
 */
export const KIND_PREFIX: Partial<Record<EntryKind, string>> = {
  bot_command: '🤖',
  bot_callback: '🤖',
  bot_event: '🤖',
  scene_step: '🤖',
  event: '⚡',
  cron: '⏱',
};

export const ASCII_KIND_PREFIX: Partial<Record<EntryKind, string>> = {
  bot_command: '&',
  bot_callback: '&',
  bot_event: '&',
  scene_step: '&',
  event: '~',
  cron: '+',
};

/** Nodes the walk invents rather than reads: a repeat, a gap, a heading. */
const SYNTHETIC = { ref: '↺', missing: '✗', group: '·' } as const;
const ASCII_SYNTHETIC = { ref: '(cycle)', missing: 'x', group: '-' } as const;

/** Marks a repo boundary on the child that crosses it. */
export const CROSSING = '⇢';
export const ASCII_CROSSING = '=>';

/**
 * How much an edge can be trusted, said only when it is less than proven.
 *
 * `static` prints nothing: an unmarked line is the common case, and marking it
 * would bury the three that deserve a second look.
 */
export const CONFIDENCE_MARK: Record<Confidence, string> = {
  static: '',
  marker: '#marker',
  heuristic: '~heuristic',
  runtime: '@runtime',
};

/** Glyphs a terminal draws two columns wide, which the padding has to know. */
const WIDE = new Set(['⚡', '🛡', '🤖', '⏱']);

/** Columns a prefix occupies, so the labels beside them still line up. */
export const prefixWidth = (prefix: string): number =>
  [...prefix].reduce((total, glyph) => total + (WIDE.has(glyph) ? 2 : 1), 0);

/** The glyph for a node, given its type and, for an entry, its kind. */
export const prefixFor = (type: string, kind: string | undefined, ascii: boolean): string => {
  const synthetic = (ascii ? ASCII_SYNTHETIC : SYNTHETIC)[type as keyof typeof SYNTHETIC];
  if (synthetic !== undefined) return synthetic;

  if (type === 'entry' && kind !== undefined) {
    const byKind = (ascii ? ASCII_KIND_PREFIX : KIND_PREFIX)[kind as EntryKind];
    if (byKind !== undefined) return byKind;
  }
  const table = ascii ? ASCII_PREFIX : NODE_PREFIX;
  return table[type as NodeType] ?? (ascii ? '?' : '·');
};

/**
 * The glyph for something that runs before a handler.
 *
 * A guard reference carries a kind rather than a node type, and the kind is
 * whatever the framework called it, so anything unrecognised still wears the
 * shield: it was reached by a `guarded_by` edge, which is all the glyph claims.
 */
export const guardPrefixFor = (kind: string, ascii: boolean): string => {
  const table = ascii ? ASCII_PREFIX : NODE_PREFIX;
  return table[kind as NodeType] ?? table.guard;
};
