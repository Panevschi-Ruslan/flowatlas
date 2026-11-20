import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';

/**
 * A channel as code and docs write it (P360).
 *
 * The graph names a channel whose name was built at run time with a `*` where
 * the built part goes (`channel:tenant:*:events`); a comment, a README or the
 * person asking writes the same channel with a placeholder
 * (`tenant:<id>:events`, `tenant:{id}:events`, `` `tenant:${tenantId}:events` ``,
 * `/tenants/:id/events`, `orders/[id]`), or with one value it takes
 * (`tenant:42:events`). Every tool that takes a channel reads all of those as
 * the channel they denote, so an agent does not spend a call learning the
 * graph's spelling: one channel answers, several are listed, none falls back
 * to the near names as before. An exact name is looked up first and answers
 * as it always has.
 */

/**
 * The placeholders a channel is written with: `${expr.path}`, `{id}`, `<id>`,
 * `[id]`, and `:id` at the start of the name or of a `/`- or `.`-separated
 * segment (`orders:created` is a name, not a placeholder).
 */
const PLACEHOLDER = /\$\{[^}]*\}|\{[^}]*\}|<[^>]*>|\[[^\]]*\]|(?<=^|[/.]):[A-Za-z_$][\w$]*/g;

const PREFIX = 'channel:';

/** One piece of a name: a character written out, or a part anything may stand in (`*` in the graph, a placeholder asked). */
type Piece = string | null;

const piecesOf = (name: string, wildcard: RegExp): Piece[] => {
  const pieces: Piece[] = [];
  let at = 0;
  for (const found of name.matchAll(wildcard)) {
    for (const char of name.slice(at, found.index)) pieces.push(char);
    if (pieces.at(-1) !== null) pieces.push(null);
    at = found.index + found[0].length;
  }
  for (const char of name.slice(at)) pieces.push(char);
  return pieces;
};

const GRAPH_WILDCARD = /\*+/g;

/**
 * Whether some name fits both: each part either may stand in for any run of
 * characters, the other side's written characters or its own stand-in alike.
 */
const overlap = (a: readonly Piece[], b: readonly Piece[]): boolean => {
  const memo = new Map<number, boolean>();
  const fits = (i: number, j: number): boolean => {
    const key = i * (b.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (i === a.length && j === b.length) result = true;
    else if (i < a.length && a[i] === null) result = fits(i + 1, j) || (j < b.length && fits(i, j + 1));
    else if (j < b.length && b[j] === null) result = fits(i, j + 1) || (i < a.length && fits(i + 1, j));
    else result = i < a.length && j < b.length && a[i] === b[j] && fits(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return fits(0, 0);
};

/** A name with something written in it besides separators: `*` alone or `*.*` would fit any name. */
const WRITTEN = /[A-Za-z0-9]/;

const byId = (a: GraphNode, b: GraphNode): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The channel a name denotes, with the id used when it was not the name as asked; or the channels it could mean. */
export type ChannelRef = { node: GraphNode; channelUsed?: string } | { candidates: GraphNode[] };

export const hasPlaceholder = (text: string): boolean => new RegExp(PLACEHOLDER.source).test(text);

/**
 * The channel `ref` names: as it is or without its `channel:` prefix; then,
 * written with placeholders, the channel with `*` where each stands; then
 * every channel the name fits (a placeholder against a `*` or a value, a value
 * against a `*`). `undefined` when nothing fits.
 *
 * `anyName` is for a tool that takes any node, where a plain word is far more
 * often a symbol: there a name is read as a channel only when it carries the
 * `channel:` prefix or a placeholder.
 */
export const resolveChannelRef = (db: GraphDb, ref: string, options: { anyName?: boolean } = {}): ChannelRef | undefined => {
  const trimmed = ref.trim();
  const prefixed = trimmed.startsWith(PREFIX);
  const name = prefixed ? trimmed.slice(PREFIX.length).trim() : trimmed;
  if (name === '' || /\s/.test(name)) return undefined;
  const placeholders = hasPlaceholder(name);
  if (options.anyName === true && !prefixed && !placeholders) return undefined;

  const exact = db.node(`${PREFIX}${name}`);
  if (exact?.type === 'channel') return { node: exact };

  const asked = piecesOf(name, PLACEHOLDER);
  // A name of nothing but placeholders would fit every channel: it names none.
  if (!asked.some((piece) => piece !== null && WRITTEN.test(piece))) return undefined;
  if (placeholders) {
    // The graph's own spelling: one `*` where each placeholder stands.
    const starred = db.node(`${PREFIX}${name.replace(PLACEHOLDER, '*').replace(GRAPH_WILDCARD, '*')}`);
    if (starred?.type === 'channel') return { node: starred, channelUsed: starred.id };
  }

  const fitting = db.nodesByType('channel').filter((channel) => {
    const label = channel.id.slice(PREFIX.length);
    // A channel that spells nothing out (`*`) would fit every name; a value
    // fits only a channel the graph could not spell out, the others being exact.
    if (!WRITTEN.test(label) || (!placeholders && !label.includes('*'))) return false;
    return overlap(asked, piecesOf(label, GRAPH_WILDCARD));
  });
  if (fitting.length === 0) return undefined;
  if (fitting.length === 1) {
    const [only] = fitting as [GraphNode];
    return { node: only, channelUsed: only.id };
  }
  return { candidates: fitting.sort(byId) };
};
