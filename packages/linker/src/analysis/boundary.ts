import {
  DEPLOYMENT_UNREAD_REASONS,
  FORWARDS_UNREAD_META,
  gapFindingOf,
  isMessageTypeNode,
  makeMessageTypeId,
  MESSAGE_TYPE_UNREAD_META,
  messageTypesOf,
  RELAYS_UNREAD_META,
  ROUTES_UNREAD_REASONS,
  selectionsOf,
  STREAM_KIND,
  type GraphNode,
  type Precision,
} from '@flowatlas/core';
import type { AnchoredUnresolvedRow, GraphDb } from '../db/reader.js';
import { EVERY_CHANNEL_VIA } from '../every-channel-link.js';
import { oneSegmentOff, pathAnswers } from '../route-match.js';
import { unreachedHandler } from './message-types.js';

/**
 * What looks broken between the services (P384): the mismatches the graph
 * already holds that are defects where one more fact holds, each gated on that
 * fact (its evidence predicate) and said with the evidence, who meets it and
 * the nearest fix. Where the fact does not hold the candidate is held back and
 * counted with why, never named a defect and never silence.
 */

/** One defect between the services, before it is ranked. */
export interface BoundaryFinding {
  kind: string;
  /** The node it is about: the request, the annotated method, the reading code, the handler. */
  id: string;
  service: string;
  loc?: string;
  message: string;
  precision: Precision;
  /** The fact that makes it a defect, in words. */
  evidence: string;
  /** The nearest fix: the route it was probably meant for, the field it was probably renamed from. */
  fix?: string;
  /** The ids the fix names. */
  nearest?: string[];
  /** The ways in that reach the sending side: who meets the defect. */
  seenBy?: string[];
  /** How many ways in reach the sending side, where more than `seenBy` lists. */
  waysIn?: number;
  /** The other end: the service, the channel or type, the route. */
  to?: string;
}

/** A candidate whose evidence did not hold, and why. */
export interface HeldBack {
  kind: string;
  id: string;
  why: string;
}

export type Promoted = { finding: BoundaryFinding } | { held: HeldBack };

/** How many ways in a finding names; the rest are counted. */
const SEEN_BY = 3;

/** How many nearest routes a fix names. */
const NEAREST = 2;

/** The edges a walk back from a request follows to the ways in that send it. */
const BACKWARD = ['handles', 'calls', 'emits', 'consumes', 'http_calls', 'hits', 'triggers'] as const;
const WALK = { maxDepth: 12, maxNodes: 2000 } as const;

const nodeLoc = (node: Pick<GraphNode, 'file' | 'line'> | undefined): string | undefined =>
  node?.file === undefined ? undefined : node.line === undefined ? node.file : `${node.file}:${node.line}`;

const rowLoc = (row: Pick<AnchoredUnresolvedRow, 'file' | 'line'>): string | undefined =>
  row.file === null ? undefined : row.line === null || row.line === 0 ? row.file : `${row.file}:${row.line}`;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The ways in that reach a node, nearest first, as `METHOD /path (service)`; and how many. */
export const waysInReaching = (db: GraphDb, id: string): { seenBy: string[]; waysIn: number } => {
  const entries = db
    .traverse({ from: id, direction: 'in', edgeTypes: BACKWARD, ...WALK })
    .rows.filter((row) => row.type === 'entry' && row.id !== id)
    .sort((a, b) => a.depth - b.depth || byText(a.id, b.id));
  return {
    seenBy: entries.slice(0, SEEN_BY).map((row) => `${row.label}${row.service === null ? '' : ` (${row.service})`}`),
    waysIn: entries.length,
  };
};

/** A route path that answers whatever follows it, so a request beneath it may land there. */
const CATCH_ALL = /\*|\(\.\*\)|\[\.\.\.|\{\+|:[A-Za-z_]+\+/;

const pathOf = (route: GraphNode): string => String(route.meta?.['path'] ?? '');
const verbOf = (route: GraphNode): string => String(route.meta?.['method'] ?? '').toUpperCase();

/**
 * Whether every route of a service was read (P384): the evidence a request to
 * no route of it needs to be a call to a route that does not exist. No row of
 * the service says a route, a mount or the address it is served at went
 * unread, and no route of it is a catch-all that could answer the request.
 */
export interface RoutesRead {
  whole: boolean;
  /** Why not, in words, where not. */
  why?: string;
}

export const routesReadOf = (
  db: GraphDb,
  service: string,
  rows: readonly AnchoredUnresolvedRow[],
): RoutesRead => {
  if (!db.services().some((each) => each.name === service)) return { whole: false, why: `${service} is not a configured service` };
  const unread = [...new Set(rows.filter((row) => row.service === service && ROUTES_UNREAD_REASONS.has(row.reason)).map((row) => row.reason))].sort(byText);
  if (unread.length > 0) return { whole: false, why: `some routes of ${service} were not read (${unread.join(', ')})` };
  const routes = db.nodesByType('entry', 'http').filter((route) => route.repo === service);
  if (routes.length === 0) return { whole: false, why: `no route of ${service} was read` };
  const catchAll = routes.find((route) => CATCH_ALL.test(pathOf(route)));
  if (catchAll !== undefined) return { whole: false, why: `${catchAll.label} of ${service} may answer it` };
  return { whole: true };
};

const segments = (path: string): string[] => path.split('/').filter((segment) => segment !== '');

/**
 * The routes of a service a request was probably meant for, nearest first:
 * one segment off (a renamed segment), the same path under another verb, the
 * path with or without a prefix in front of it.
 */
export const nearestRoutes = (db: GraphDb, service: string, method: string, path: string): Array<{ id: string; said: string }> => {
  const routes = db
    .nodesByType('entry', 'http')
    .filter((route) => route.repo === service)
    .sort((a, b) => byText(a.id, b.id));
  const found: Array<{ id: string; said: string }> = [];
  const add = (route: GraphNode, said: string): void => {
    if (!found.some((each) => each.id === route.id)) found.push({ id: route.id, said });
  };
  for (const route of routes) {
    const off = oneSegmentOff(method, path, route);
    if (off !== undefined) add(route, `${route.label} (one segment off: ${off})`);
  }
  for (const route of routes) {
    if (verbOf(route) !== method && pathAnswers(pathOf(route), path)) add(route, `${route.label} (the same path under ${verbOf(route)})`);
  }
  const asked = segments(path);
  for (const route of routes) {
    if (verbOf(route) !== method) continue;
    const ours = segments(pathOf(route));
    // Only a prefix: the paths agree on every segment the shorter one has.
    if (ours.length > asked.length && pathAnswers(`/${ours.slice(ours.length - asked.length).join('/')}`, path)) {
      add(route, `${route.label} (served under /${ours.slice(0, ours.length - asked.length).join('/')})`);
    } else if (asked.length > ours.length && ours.length > 0 && pathAnswers(pathOf(route), `/${asked.slice(asked.length - ours.length).join('/')}`)) {
      add(route, `${route.label} (asked under /${asked.slice(0, asked.length - ours.length).join('/')})`);
    }
  }
  return found.slice(0, NEAREST);
};

/** The request's own words: the plain sentence a request to no route is written in. */
const NO_ROUTE = /^target service (\S+) has no route ([A-Z]+) (\S+)$/;
/** An annotation naming a route its service does not serve. */
const MARKER_NO_ROUTE = /points at ([A-Z]+) (\S+), which (\S+) does not serve$/;

const said = (method: string, path: string): string => `${method} ${path}`;

/** A request to no route as a defect, where every route of its target was read. */
const callToMissingRoute = (db: GraphDb, row: AnchoredUnresolvedRow, all: readonly AnchoredUnresolvedRow[]): Promoted => {
  const promoted = gapFindingOf(row.reason)!;
  const id = row.node ?? `gap:${row.service ?? ''}|${row.file ?? ''}|${row.reason}`;
  const words = NO_ROUTE.exec(row.message);
  if (words === null) {
    return {
      held: {
        kind: promoted.kind,
        id,
        why: row.message.includes('read in full') ? 'part of the address of the route that may answer it was not read' : 'the service it is sent to is not named',
      },
    };
  }
  const [, target = '', method = '', path = ''] = words;
  const read = routesReadOf(db, target, all);
  if (!read.whole) return { held: { kind: promoted.kind, id, why: read.why ?? 'not every route of the target was read' } };
  const request = row.node === null ? undefined : db.node(row.node);
  const sender = request === undefined ? undefined : db.edgesTo(request.id, ['calls'])[0]?.from;
  const near = nearestRoutes(db, target, method, path);
  const ways = request === undefined ? { seenBy: [], waysIn: 0 } : waysInReaching(db, request.id);
  const loc = rowLoc(row);
  const from = sender === undefined ? (row.service ?? '') : (db.node(sender)?.label ?? sender);
  return {
    finding: {
      kind: promoted.kind,
      id,
      service: row.service ?? '',
      ...(loc === undefined ? {} : { loc }),
      message: `${from} sends ${said(method, path)} to ${target}, which serves no such route`,
      precision: promoted.precision,
      evidence: promoted.evidence,
      ...(near.length === 0 ? {} : { fix: `the nearest route: ${near.map((each) => each.said).join('; ')}`, nearest: near.map((each) => each.id) }),
      ...(ways.seenBy.length === 0 ? {} : { seenBy: ways.seenBy }),
      ...(ways.waysIn > ways.seenBy.length ? { waysIn: ways.waysIn } : {}),
      to: target,
    },
  };
};

/** An annotation naming a route its service does not serve, where every route of that service was read. */
const annotationToMissingRoute = (db: GraphDb, row: AnchoredUnresolvedRow, all: readonly AnchoredUnresolvedRow[]): Promoted => {
  const promoted = gapFindingOf(row.reason)!;
  const id = row.node ?? `gap:${row.service ?? ''}|${row.file ?? ''}|${row.reason}`;
  const words = MARKER_NO_ROUTE.exec(row.message);
  if (words === null) return { held: { kind: promoted.kind, id, why: 'the route the annotation names is not read off it' } };
  const [, method = '', path = '', target = ''] = words;
  const read = routesReadOf(db, target, all);
  if (!read.whole) return { held: { kind: promoted.kind, id, why: read.why ?? 'not every route of the service was read' } };
  const near = nearestRoutes(db, target, method, path);
  const loc = rowLoc(row);
  return {
    finding: {
      kind: promoted.kind,
      id,
      service: row.service ?? '',
      ...(loc === undefined ? {} : { loc }),
      message: row.message,
      precision: promoted.precision,
      evidence: promoted.evidence,
      ...(near.length === 0 ? {} : { fix: `the nearest route: ${near.map((each) => each.said).join('; ')}`, nearest: near.map((each) => each.id) }),
      to: target,
    },
  };
};

/** Code sending to an environment value its deployment does not set, where that deployment was read whole. */
const envNotSet = (db: GraphDb, row: AnchoredUnresolvedRow, all: readonly AnchoredUnresolvedRow[]): Promoted => {
  const promoted = gapFindingOf(row.reason)!;
  const id = row.node ?? `gap:${row.service ?? ''}|${row.file ?? ''}|${row.reason}`;
  const fnId = typeof row.meta?.['function'] === 'string' ? row.meta['function'] : undefined;
  const fn = fnId === undefined ? undefined : db.node(fnId);
  if (fn === undefined) return { held: { kind: promoted.kind, id, why: 'the function that runs it is not in the graph' } };
  const deployedBy = fn.repo;
  // A row about another function's value says nothing of this one's environment.
  const aboutIt = (each: AnchoredUnresolvedRow): boolean => typeof each.meta?.['function'] !== 'string' || each.meta['function'] === fn.id;
  const unread = [
    ...new Set(all.filter((each) => each.service === deployedBy && DEPLOYMENT_UNREAD_REASONS.has(each.reason) && aboutIt(each)).map((each) => each.reason)),
  ].sort(byText);
  if (unread.length > 0) return { held: { kind: promoted.kind, id, why: `the deployment of ${deployedBy} was not read whole (${unread.join(', ')})` } };
  const ways = waysInReaching(db, fn.id);
  const loc = rowLoc(row);
  return {
    finding: {
      kind: promoted.kind,
      id,
      service: row.service ?? '',
      ...(loc === undefined ? {} : { loc }),
      message: row.message,
      precision: promoted.precision,
      evidence: promoted.evidence,
      ...(typeof row.meta?.['variable'] === 'string' ? { fix: `set ${row.meta['variable']} where ${fn.label} is deployed, or read the name it is set under` } : {}),
      ...(ways.seenBy.length === 0 ? {} : { seenBy: ways.seenBy }),
      to: fn.id,
    },
  };
};

/** How each gap that may be a defect is tested (a Strategy by reason, one per `GAP_FINDINGS` entry). */
const PROMOTERS: Readonly<Record<string, (db: GraphDb, row: AnchoredUnresolvedRow, all: readonly AnchoredUnresolvedRow[]) => Promoted>> = {
  'target-route-not-found': callToMissingRoute,
  'marker-route-not-found': annotationToMissingRoute,
  'environment-not-set': envNotSet,
};

/**
 * A gap row as a defect where its evidence holds, held back with why where it
 * does not, or undefined for a row no rule promotes. `all` is every row of the
 * graph, accepted ones too: a route somebody accepted as unread is still unread.
 */
export const promoteGap = (db: GraphDb, row: AnchoredUnresolvedRow, all: readonly AnchoredUnresolvedRow[]): Promoted | undefined =>
  Object.hasOwn(PROMOTERS, row.reason) ? PROMOTERS[row.reason]!(db, row, all) : undefined;

/** The words of an identifier, lower case: `deskNumber`, `desk_number` and `DESK-NUMBER` are `desk`, `number`. */
export const identifierWords = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());

/**
 * The one of several names most likely the same thing renamed: sharing a word
 * with it (`deskNumber`, `deskId`), or spelled a letter or two apart. Undefined
 * where none is near or two are equally near.
 */
export const likelyRenamed = (name: string, others: readonly string[]): string | undefined => {
  const ours = new Set(identifierWords(name));
  const scored = others
    .filter((other) => other !== name)
    .map((other) => {
      const theirs = identifierWords(other);
      const shared = theirs.filter((word) => ours.has(word)).length;
      const share = shared / Math.max(ours.size, theirs.length, 1);
      // A word shared counts by its share; a spelling a letter or two apart adds half (`CANCELED`, `CANCELLED`).
      return { other, score: share + (closeSpelling(name.toLowerCase(), other.toLowerCase()) ? 0.5 : 0) };
    })
    .filter((each) => each.score >= 0.5)
    .sort((a, b) => b.score - a.score || byText(a.other, b.other));
  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[1]!.score === scored[0]!.score) return undefined;
  return scored[0]!.other;
};

/** Two spellings at most two edits apart, neither of them short. */
export const closeSpelling = (a: string, b: string): boolean => {
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row.push(Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    previous = row;
  }
  return previous[b.length]! <= 2;
};

/**
 * What one channel a consumer receives carries, as far as its publishes say:
 * the types they send, or why that is not known whole.
 */
interface ChannelCarries {
  channel: GraphNode;
  producers: number;
  types: ReadonlySet<string>;
  /** Why the types on it may not be all it carries. */
  unknown?: string;
}

/** The types a channel's publishes say they send, and whether that is all it may carry. */
const carriesOf = (db: GraphDb, channel: GraphNode): ChannelCarries => {
  const producers = db.edgesTo(channel.id, ['emits']).flatMap((each) => db.node(each.from) ?? []);
  const types = new Set(producers.flatMap((producer) => messageTypesOf(producer)));
  const unread = producers.filter((producer) => typeof producer.meta?.[MESSAGE_TYPE_UNREAD_META] === 'string').length;
  const base = { channel, producers: producers.length, types };
  if (unread > 0) return { ...base, unknown: `${unread} publish(es) on ${channel.label} send a type not read` };
  // A hub that stands for the channels it is handed by name carries what they carry, where every write to it names one.
  const forwards = channel.meta?.['forwards'];
  const forwardsUnread = channel.meta?.[FORWARDS_UNREAD_META];
  if (typeof forwardsUnread === 'number' && forwardsUnread > 0) {
    return { ...base, unknown: `${forwardsUnread} write(s) to ${channel.label} hand it a channel not read` };
  }
  if (Array.isArray(forwards) && forwards.length > 0) return base;
  if (producers.length === 0) return { ...base, unknown: `nothing publishing on ${channel.label} was read` };
  // A hub written to directly, its writes saying no type: what it hands its streams is not read.
  if (typeof channel.meta?.['heldBy'] === 'string' && types.size === 0) return { ...base, unknown: `the ${producers.length} write(s) to ${channel.label} say no type` };
  return base;
};

/** Why the channels a consumer receives may not be all of them: a stream route relaying channels not all read. */
const channelsUnknown = (db: GraphDb, edges: readonly { meta?: Record<string, unknown> | undefined }[]): string | undefined => {
  for (const edge of edges) {
    if (edge.meta?.['via'] !== STREAM_KIND) continue;
    const route = typeof edge.meta['route'] === 'string' ? db.node(edge.meta['route']) : undefined;
    const why = route?.meta?.[RELAYS_UNREAD_META];
    if (typeof why === 'string') return why;
  }
  return undefined;
};

/**
 * Consumers choosing a type of message nothing publishes (P384), the reverse
 * of `message-type-unselected`: a handler waiting for a message that never
 * comes, usually the type renamed or respelled on the publishing side. Read
 * off what each consumer records it selects, set against the types the
 * publishes say they send on every channel the consumer receives (P395): a
 * screen fed through a stream route that relays several channels, or through
 * a hub handed several, receives them all, and a type sent on any of them is
 * published for it. The linker draws no type node for a selection no publish
 * sends, so the graph's type nodes alone cannot say it.
 *
 * A defect only where the consumer's channels are known whole and every
 * publish on each says the type it sends. Held back, with why, where one
 * sends a type not read (which may be this one), where a stream route feeding
 * the consumer relays a channel not read (a subscription whose channel is
 * worked out when the code runs, an object whose class is not read), where a
 * hub is written to with a channel not read, or where nothing publishing on
 * one of several channels was read. A consumer none of whose channels has a
 * publish saying a type (a one-ended channel is listed under its own kind),
 * and a subscriber to every channel of a bus, are not judged.
 */
export const typesNeverPublished = (db: GraphDb): Promoted[] => {
  const out: Promoted[] = [];
  const seen = new Set<string>();
  const consumers = db.nodesByType('consumer').sort((a, b) => byText(a.id, b.id));
  for (const consumer of consumers) {
    const selections = selectionsOf(consumer);
    if (selections.length === 0) continue;
    const edges = db.edgesTo(consumer.id, ['consumes']).filter((edge) => edge.meta?.['via'] !== EVERY_CHANNEL_VIA);
    const channels = [
      ...new Map(
        edges
          .map((edge) => db.node(edge.from))
          .filter((channel): channel is GraphNode => channel !== undefined && channel.type === 'channel' && !isMessageTypeNode(channel))
          .map((channel) => [channel.id, channel] as const),
      ).values(),
    ].sort((a, b) => byText(a.id, b.id));
    const carried = channels.map((channel) => carriesOf(db, channel));
    const published = new Set(carried.flatMap((each) => [...each.types]));
    if (published.size === 0) continue;
    const unknown = channelsUnknown(db, edges) ?? carried.find((each) => each.unknown !== undefined)?.unknown;
    // The channel a row is filed under: the first that says types, so the call it names shows what is published.
    const said = carried.filter((each) => each.types.size > 0);
    const home = said[0]!;
    for (const selection of selections) {
      if (published.has(selection.type) || selection.heuristic === true) continue;
      const handler = db.node(selection.consumer);
      if (handler === undefined || unreachedHandler(db, handler) !== undefined) continue;
      const id = makeMessageTypeId(home.channel.id, selection.type);
      if (seen.has(`${selection.type}|${handler.id}`)) continue;
      seen.add(`${selection.type}|${handler.id}`);
      if (unknown !== undefined) {
        out.push({ held: { kind: 'type-never-published', id, why: unknown } });
        continue;
      }
      const types = [...published].sort(byText);
      const renamed = likelyRenamed(selection.type, types);
      const file = selection.file ?? handler.file;
      // Who meets it: the ways in reaching the publishes on every channel it receives.
      const reached = carried.map((each) => waysInReaching(db, each.channel.id));
      const ways = { seenBy: [...new Set(reached.flatMap((each) => each.seenBy))].slice(0, SEEN_BY) };
      const producers = carried.reduce((sum, each) => sum + each.producers, 0);
      const one = carried.length === 1;
      const labels = carried.map((each) => each.channel.label).join(', ');
      out.push({
        finding: {
          kind: 'type-never-published',
          id,
          service: handler.repo,
          ...(file === undefined ? {} : { loc: `${file}:${selection.line}` }),
          message: one
            ? `${handler.label} handles ${selection.type} on ${home.channel.label}, which nothing publishes; its ${producers} publish(es) send ${types.join(', ')}`
            : `${handler.label} handles ${selection.type}, which nothing publishes on the ${carried.length} channels it receives (${labels}); their ${producers} publish(es) send ${types.join(', ')}`,
          precision: 'high',
          evidence: one
            ? `every publish on ${home.channel.label} says the type it sends`
            : `every channel it receives was read, and every publish on each says the type it sends`,
          ...(renamed === undefined ? {} : { fix: `likely renamed: ${renamed} is published, ${selection.type} is handled` }),
          ...(ways.seenBy.length === 0 ? {} : { seenBy: ways.seenBy }),
          to: home.channel.id,
        },
      });
    }
  }
  return out;
};
