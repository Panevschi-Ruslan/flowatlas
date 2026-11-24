import { isEntryId, isMessageTypeNode, type GraphEdge } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveChannelRef } from '../query/channel-ref.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { loadObserved } from '../query/observed.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { reachReader } from '../query/ways-in.js';
import { answerOf } from '../query/answer-fields.js';
import { bodyReadsOf, channelContract, channelsCarrying, requestFields } from './fields-contract.js';
import {
  callOf,
  commonInput,
  completeOf,
  READ_ONLY,
  withDb,
  type ContractFinding,
  type ToolContext,
  type TrafficSideSaid,
} from './common.js';

/**
 * A finding as it goes out (P93): what disagrees and how. The checker's own
 * finding names the edge, its key and both parties on every row, and the
 * answer names the edge once at the top.
 */
export const wireFinding = (finding: ContractFinding): ContractFinding => ({
  severity: finding.severity,
  kind: finding.kind,
  direction: finding.direction,
  field: finding.field,
  expected: finding.expected,
  actual: finding.actual,
  message: finding.message,
  ...(finding.ignored === true ? { ignored: true } : {}),
});

/** One difference traffic showed (P113), as it goes out: the field, how often it was carried, and the sentence. */
const wireTrafficDiff = (diff: TrafficSideSaid['diffs'][number]) => ({
  severity: diff.severity,
  kind: diff.kind,
  field: diff.path,
  expected: diff.expected,
  actual: diff.actual,
  seenIn: diff.seenIn,
  of: diff.of,
  message: diff.message,
});

/** What traffic carried into an entry, against what its code declares (P113). */
export interface TrafficAnswer {
  /** Exchanges read for shapes. */
  samples: number;
  /** The hours the shapes were seen over. */
  window: { from: string | null; to: string | null };
  /** The declared types compared against, by direction. */
  against?: { request?: string; response?: string };
  request?: ReturnType<typeof wireTrafficDiff>[];
  responses?: Record<string, ReturnType<typeof wireTrafficDiff>[]>;
  /** What was not compared, and why: `request: no-declared-type`, `response 500: status-not-declared`. */
  unchecked?: string[];
}

/**
 * What traffic carried into `entry` against its code (P113): nothing when the
 * observed file holds no shapes of it or no checker was handed in. `caller`
 * is the call being checked, whose expected answer stands in for a route
 * that declares none.
 */
export const trafficFor = (ctx: ToolContext, entry: string, caller?: GraphEdge): TrafficAnswer | undefined => {
  const observed = loadObserved(ctx.handle.path);
  const shapes = observed?.shapes?.[entry];
  if (observed === undefined || shapes === undefined || ctx.trafficChecker === undefined) return undefined;
  const compared = ctx.trafficChecker({ entry, shapes, ...(caller === undefined ? {} : { caller }) });
  if (compared === undefined) return undefined;
  const responses = Object.entries(compared.responses ?? {});
  const response = responses[0]?.[1].against.typeId;
  return {
    samples: compared.samples,
    window: { from: observed.window.from, to: observed.window.to },
    ...(compared.request === undefined && response === undefined
      ? {}
      : {
          against: {
            ...(compared.request === undefined ? {} : { request: compared.request.against.typeId }),
            ...(response === undefined ? {} : { response }),
          },
        }),
    ...(compared.request === undefined ? {} : { request: compared.request.diffs.map(wireTrafficDiff) }),
    ...(responses.length === 0
      ? {}
      : { responses: Object.fromEntries(responses.map(([status, side]) => [status, side.diffs.map(wireTrafficDiff)])) }),
    ...(compared.unchecked.length === 0
      ? {}
      : {
          unchecked: compared.unchecked.map(
            (row) => `${row.direction}${row.status === undefined ? '' : ` ${row.status}`}: ${row.reason}`,
          ),
        }),
  };
};

/** Whether traffic into an entry differs from its code (P113): what `get_flow` hints `check_contract` on. */
export const trafficDiffers = (ctx: ToolContext, entry: string): boolean => {
  const observed = loadObserved(ctx.handle.path);
  const shapes = observed?.shapes?.[entry];
  return shapes !== undefined && (ctx.trafficChecker?.({ entry, shapes })?.differs ?? 0) > 0;
};

/**
 * How well the two ends of an edge agree about what crosses it.
 *
 * `shared` means neither end owns the declaration: both import it from a
 * package the project shares, so they cannot drift apart. `identical` means two
 * separate declarations that happen to have the same shape today.
 */
export type ContractStatus = 'shared' | 'identical' | 'hash_differs' | 'unchecked';

/** One direction of the exchange, and how well the two ends agree about it. */
export interface ContractSide {
  status: ContractStatus;
  left?: string;
  right?: string;
  note?: string;
}

/** A type id, as opposed to a bare `string` or `object` the reader wrote down. */
const isTypeId = (value: string | undefined): value is string => value?.startsWith('type:') === true;

export const classify = (
  db: GraphDb,
  left: string | undefined,
  right: string | undefined,
): ContractSide => {
  const both = { ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) };
  if (!isTypeId(left) || !isTypeId(right)) {
    const missing = !isTypeId(left) ? 'sending' : 'receiving';
    return {
      status: 'unchecked',
      ...both,
      note: `the ${missing} side declares no named type`,
    };
  }
  if (left === right) {
    const shared = db.type(left)?.meta?.['sharedPackage'];
    return typeof shared === 'string'
      ? { status: 'shared', ...both, note: `both sides import it from ${shared}` }
      : { status: 'identical', ...both };
  }
  const a = db.type(left);
  const b = db.type(right);
  if (a === undefined || b === undefined) {
    return { status: 'unchecked', ...both, note: 'a type id on the edge is not in the registry' };
  }
  return {
    status: a.structuralHash === b.structuralHash ? 'identical' : 'hash_differs',
    ...both,
  };
};

/** The worse of two verdicts, so one number says whether to look closer; the page reads the same order (P134). */
export const CONTRACT_STATUS_RANK: Readonly<Record<ContractStatus, number>> = {
  shared: 0,
  identical: 1,
  unchecked: 2,
  hash_differs: 3,
};

const RANK = CONTRACT_STATUS_RANK;

const worse = (a: ContractStatus, b: ContractStatus): ContractStatus => (RANK[a] >= RANK[b] ? a : b);

/**
 * What crosses the edge, in both directions.
 *
 * A request has two halves and they fail differently: the caller can send a
 * body the handler cannot read, and the handler can answer with a shape the
 * caller does not expect. Both are checked, because fixing one says nothing
 * about the other.
 */
const sidesOf = (
  db: GraphDb,
  edge: GraphEdge,
): { request: ContractSide; response: ContractSide } => {
  const handler = db.edgesFrom(edge.to, ['handles'])[0];
  return {
    request: classify(db, edge.params?.[0], handler?.params?.[0]),
    response: classify(db, edge.returns, handler?.returns),
  };
};

/**
 * One crossing from one service into another (P94): a request that reaches an
 * entry of the other, or a publish onto a channel the other handles, with its
 * verdict and the call that checks it in full.
 */
export interface Crossing {
  from: string;
  to: string;
  type: string;
  /** The channel a publish crosses through. */
  via?: string;
  status: ContractStatus;
  check: string;
}

/** The edges that cross by a request, from a call site to an entry. */
export const REQUEST_EDGES = ['http_calls', 'hits'] as const;

/**
 * The verdict on one crossing: a request edge by both halves, as
 * `check_contract` judges it, or a publish by what the publisher sends
 * against what the consumer's subscription (`consumed`) reads. The page
 * ships it for the crossings it lists (P134), since it holds no registry.
 */
export const crossingStatusOf = (db: GraphDb, edge: GraphEdge, consumed?: GraphEdge): ContractStatus => {
  if (consumed !== undefined) return classify(db, edge.params?.[0], consumed.params?.[0]).status;
  const { request, response } = sidesOf(db, edge);
  return worse(request.status, response.status);
};

const byWorstThenId = (a: Crossing, b: Crossing): number =>
  RANK[b.status] - RANK[a.status] || (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0);

/**
 * Every crossing from service `a` into service `b`, worst verdict first.
 *
 * Requests are judged as `check_contract` judges one edge, both halves; a
 * publish by what the publisher sends against what the handler's subscription
 * reads, which is unchecked where either side names no type.
 */
export const crossingsBetween = (db: GraphDb, a: string, b: string): Crossing[] => {
  const serviceOf = (id: string): string | undefined => db.node(id)?.repo;
  const crossings: Crossing[] = [];
  for (const edge of db.allEdges()) {
    const isRequest = (REQUEST_EDGES as readonly string[]).includes(edge.type);
    if ((!isRequest && edge.type !== 'emits') || serviceOf(edge.from) !== a) continue;
    if (isRequest) {
      const target = db.node(edge.to);
      if (target?.type !== 'entry' || target.repo !== b) continue;
      crossings.push({
        from: edge.from,
        to: edge.to,
        type: edge.type,
        status: crossingStatusOf(db, edge),
        check: callOf('check_contract', { from: edge.from, to: edge.to }),
      });
    } else if (edge.type === 'emits') {
      for (const consumed of db.edgesFrom(edge.to, ['consumes'])) {
        if (serviceOf(consumed.to) !== b) continue;
        crossings.push({
          from: edge.from,
          to: consumed.to,
          type: 'emits',
          via: edge.to,
          status: crossingStatusOf(db, edge, consumed),
          check: callOf('check_contract', { from: edge.from, to: edge.to }),
        });
      }
    }
  }
  return crossings.sort(byWorstThenId);
};

/** Two names that are services and not nodes: a question about every crossing between them. */
const asServices = (db: GraphDb, from: string, to: string): boolean => {
  if (db.node(from) !== undefined || db.node(to) !== undefined) return false;
  const names = new Set(db.services().map((service) => service.name));
  return names.has(from) && names.has(to);
};

/** `from -type-> to`, the way an edge is named when one is asked for by hand. */
const parseEdgeRef = (ref: string): { from: string; type?: string; to: string } | undefined => {
  const arrow = /^(.*?)\s*-([a-z_]+)->\s*(.*)$/.exec(ref.trim());
  if (arrow !== null) {
    return { from: (arrow[1] ?? '').trim(), type: arrow[2], to: (arrow[3] ?? '').trim() };
  }
  const plain = ref.split('->');
  if (plain.length !== 2) return undefined;
  return { from: (plain[0] ?? '').trim(), to: (plain[1] ?? '').trim() };
};

/**
 * A route or entry that names nothing in the graph (P382): the nearest ways
 * in, each as the call that checks it, or the search that finds a route by
 * its path; never a bare "no entry" that sends the agent to grep.
 */
const noEntry = (db: GraphDb, asked: string, field: string | undefined): object => {
  // An entry id is looked for by its route as said aloud: `entry:shop:http:GET:/x` as `GET /x`.
  const route = /^entry:[^:]+:http:([A-Z]+):(.*)$/.exec(asked.trim());
  const aloud = route === null ? asked.trim() : `${route[1]} ${route[2]}`;
  const near = nearNames(db.nodesByType('entry'), aloud, 3);
  return withNext(
    { error: `no way in matches ${JSON.stringify(asked.trim())}`, ...(near.length === 0 ? {} : { near: near.map((node) => node.id) }) },
    near.length > 0
      ? near.slice(0, MAX_NEXT).map((node) => callOf('check_contract', { edge: node.id, field }))
      : [callOf('search', { query: aloud, kinds: ['routes'] })],
  );
};

/**
 * The calls that would answer, where none was named (P382): for one end
 * alone that is no way in, each call it makes to a route or each call into
 * it; otherwise the first route something calls and the first channel with a
 * publish, so the agent sees the inputs filled in rather than a rule.
 */
const exampleCalls = (db: GraphDb, field: string | undefined, end: string | undefined): string[] => {
  const node = end === undefined ? undefined : db.node(end.trim());
  if (node !== undefined) {
    const calls = [
      // A handler: the route it handles, checked as a route.
      ...db.edgesTo(node.id, ['handles']).flatMap((edge) => (isEntryId(edge.from) ? [callOf('check_contract', { edge: edge.from, field })] : [])),
      ...db.edgesFrom(node.id, [...REQUEST_EDGES]).map((edge) => callOf('check_contract', { from: edge.from, to: edge.to, field })),
      ...db.edgesTo(node.id, [...REQUEST_EDGES]).map((edge) => callOf('check_contract', { from: edge.from, to: edge.to, field })),
    ];
    if (calls.length > 0) return calls.slice(0, MAX_NEXT);
  }
  const called = db.allEdges().find((edge) => (REQUEST_EDGES as readonly string[]).includes(edge.type) && isEntryId(edge.to));
  const published = db.nodesByType('channel').find((channel) => !isMessageTypeNode(channel) && db.edgesTo(channel.id, ['emits']).length > 0);
  return [
    ...(called === undefined ? [] : [callOf('check_contract', { edge: db.node(called.to)?.label ?? called.to, field })]),
    ...(published === undefined ? [] : [callOf('check_contract', { channel: published.id, field })]),
  ];
};

/**
 * A type of message several channels carry, asked as the channel (P382):
 * each channel's answer for that type, in one answer, as several symbols
 * are answered; the whole answer only when each is.
 */
const severalChannels = (
  db: GraphDb,
  reader: ReturnType<typeof reachReader>,
  carried: ReadonlyArray<{ channel: string; type: string }>,
  field: string | undefined,
  maxNodes: number,
): object => {
  const shown = carried.slice(0, MAX_CARRIERS);
  const answers = shown.map((one) => channelContract(db, reader, { channel: one.channel, type: one.type, field, maxNodes }) as { complete?: boolean; next?: string[] });
  return withNext(
    {
      type: carried[0]!.type,
      carriedBy: carried.map((one) => one.channel),
      answers: answers.map(({ next: _next, ...answer }) => answer),
      ...completeOf([
        ...answers.flatMap((answer, index) => (answer.complete === false ? [`unsure: the answer on ${shown[index]!.channel} is not complete`] : [])),
        carried.length > shown.length && `page: ${carried.length - shown.length} more channels carry it`,
      ]),
    },
    [],
  );
};

/** The most channels one answer about a type of message covers. */
const MAX_CARRIERS = 3;

export const registerContract = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'check_contract',
    {
      title: 'Check a contract',
      description:
        'Whether one side of a crossing sends what the other expects. A route (`edge`: "GET /x" or id): body fields read on its path, guards too, and answer fields clients read; a `channel` and `type`, or a type alone: fields read, not sent (`missing`), sent, never read (`unused`). `field` keeps one.',
      inputSchema: {
        edge: z.string().optional().describe('a route, or "<from> -http_calls-> <to>"'),
        from: z.string().optional(),
        to: z.string().optional(),
        channel: z.string().optional(),
        type: z.string().optional(),
        field: z.string().optional(),
        // `maxNodes` only. This answers about one crossing, so there is no tree
        // to thin and `detail` had nothing to apply itself to — it was declared,
        // ignored, and answered `detail: 3` with a note saying the level had
        // been clamped. A knob accepted and not read is worse than one absent.
        maxNodes: commonInput.maxNodes,
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const field = input.field?.trim() || undefined;
        // A channel, or one type of message on it (P368): what each end sends and reads.
        if (input.channel !== undefined) {
          const reader = reachReader(db, ctx.handle, 1);
          // A type of message given as the channel (P382): answered on the channel or channels carrying it.
          const carried = resolveChannelRef(db, input.channel) === undefined && input.type === undefined ? channelsCarrying(db, input.channel) : [];
          if (carried.length === 1) return channelContract(db, reader, { channel: carried[0]!.channel, type: carried[0]!.type, field, maxNodes: input.maxNodes });
          if (carried.length > 1) return severalChannels(db, reader, carried, field, input.maxNodes);
          return channelContract(db, reader, { channel: input.channel, type: input.type, field, maxNodes: input.maxNodes });
        }
        // One end alone, `{to: entry}` or `{from: entry}`: the entry it names, as `edge` would (P382).
        const alone = input.edge === undefined && (input.from === undefined) !== (input.to === undefined) ? (input.from ?? input.to) : undefined;
        const edgeAsked = input.edge ?? alone;
        // An entry said aloud, `PATCH /orders/:id/cancel`, is the entry it names (P368).
        const said = edgeAsked !== undefined && parseEdgeRef(edgeAsked) === undefined && !isEntryId(edgeAsked.trim()) ? resolveEntryRef(db, edgeAsked) : undefined;
        if (said !== undefined && !isResolved(said)) {
          if (said.candidates.length > 0) {
            return withNext(
              { error: `${JSON.stringify(edgeAsked)} names no one entry`, candidates: said.candidates.slice(0, 5).map((node) => node.id) },
              said.candidates.slice(0, 2).map((node) => callOf('check_contract', { edge: node.id, field })),
            );
          }
          if (alone === undefined) return noEntry(db, edgeAsked as string, field);
        }
        const entryAsked = said !== undefined && isResolved(said) ? said.id : edgeAsked?.trim();
        // An entry on its own (P113): what traffic carried into it against its code, and the calls into it.
        if (entryAsked !== undefined && parseEdgeRef(entryAsked) === undefined && isEntryId(entryAsked)) {
          const entry = entryAsked;
          if (db.node(entry) === undefined) return noEntry(db, entry, field);
          const into = db
            .edgesTo(entry, [...REQUEST_EDGES])
            .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
          const traffic = trafficFor(ctx, entry);
          // What the code on the request's path reads of the body (P368).
          const body = bodyReadsOf(db, entry, field);
          // What each client reads of the answer, and where that and the answer disagree (P391).
          const answer = answerOf(db, entry, field);
          return withNext(
            {
              entry,
              ...(field === undefined ? {} : { field }),
              reads: body.reads,
              ...(traffic === undefined
                ? field === undefined
                  ? { note: 'no body shapes of this entry: flowatlas observe --shapes reads them from a HAR or @nestjs/observe batches' }
                  : {}
                : { traffic }),
              ...(answer === undefined ? {} : { answer: answer.answer }),
              callers: into.length,
              ...completeOf([...body.left, ...(answer?.left ?? [])]),
            },
            into.slice(0, MAX_NEXT).map((edge) => callOf('check_contract', { from: edge.from, to: edge.to, field })),
          );
        }
        const parsed =
          input.edge !== undefined
            ? parseEdgeRef(input.edge)
            : input.from !== undefined && input.to !== undefined
              ? { from: input.from, to: input.to }
              : undefined;
        if (parsed === undefined) {
          // Nothing to check named (P382): the calls that would be, written out, never a rule to guess from.
          return withNext(
            { error: alone === undefined ? 'name what to check: a route, a channel, or both ends of a call' : `${JSON.stringify(alone)} is one end and no route: give the route it handles or both ends of its call` },
            exampleCalls(db, field, alone),
          );
        }

        // Two service names (a node of either name wins, as before): every
        // crossing between them, each with the call that checks it (P94).
        if (parsed.type === undefined && asServices(db, parsed.from, parsed.to)) {
          const all = crossingsBetween(db, parsed.from, parsed.to);
          const shown = all.slice(0, input.maxNodes);
          const byStatus: Partial<Record<ContractStatus, number>> = {};
          for (const crossing of all) byStatus[crossing.status] = (byStatus[crossing.status] ?? 0) + 1;
          const back = all.length === 0 ? crossingsBetween(db, parsed.to, parsed.from).length : 0;
          return withNext(
            {
              services: { from: parsed.from, to: parsed.to },
              crossings: shown,
              total: all.length,
              byStatus,
              ...(shown.length === all.length ? {} : { truncated: `${all.length - shown.length} more crossing(s); raise maxNodes` }),
              ...(all.length > 0
                ? {}
                : { note: `nothing crosses from ${parsed.from} to ${parsed.to}${back > 0 ? `; ${back} crossing(s) go the other way` : ''}` }),
            },
            all.length > 0
              ? shown.slice(0, MAX_NEXT).map((crossing) => crossing.check)
              : back > 0
                ? [callOf('check_contract', { from: parsed.to, to: parsed.from })]
                : [],
          );
        }

        const candidates = db
          .edgesFrom(parsed.from)
          .filter((edge) => edge.to === parsed.to)
          .filter((edge) => parsed.type === undefined || edge.type === parsed.type);
        const edge = candidates[0];
        if (edge === undefined) {
          // The calls there are, from the one end or into the other (P382): each the call that checks it.
          const into = isEntryId(parsed.to) && db.node(parsed.to) !== undefined ? [callOf('check_contract', { edge: parsed.to, field })] : [];
          const from = db
            .edgesFrom(parsed.from, [...REQUEST_EDGES])
            .slice(0, MAX_NEXT)
            .map((found) => callOf('check_contract', { from: found.from, to: found.to, field }));
          return withNext({ error: `no call from ${parsed.from} to ${parsed.to}` }, [...into, ...from].slice(0, MAX_NEXT));
        }

        const { request, response } = sidesOf(db, edge);
        const status = worse(request.status, response.status);
        const hash = (id?: string): { id: string; structuralHash: string } | undefined =>
          id === undefined ? undefined : { id, structuralHash: db.type(id)?.structuralHash ?? '' };
        const findings =
          ctx.contractChecker?.({
            edge: { from: edge.from, to: edge.to, type: edge.type },
            ...(hash(response.left) === undefined ? {} : { left: hash(response.left)! }),
            ...(hash(response.right) === undefined ? {} : { right: hash(response.right)! }),
          }) ?? [];

        const shown = findings.slice(0, input.maxNodes).map(wireFinding);
        const traffic = isEntryId(edge.to) ? trafficFor(ctx, edge.to, edge) : undefined;
        // The body's fields, sent against read on the route's path (P368).
        const fields = isEntryId(edge.to) ? requestFields(db, { id: edge.from, params: edge.params }, edge.to, field) : undefined;
        // What this request's client reads of the answer, against what the route answers (P391).
        const answer = isEntryId(edge.to) ? answerOf(db, edge.to, field, edge.from) : undefined;
        const shapes = [request.left, request.right, response.left, response.right].filter(
          (id): id is string => typeof id === 'string' && id.startsWith('type:'),
        );
        return withNext({
          edge: { from: edge.from, to: edge.to, type: edge.type, confidence: edge.confidence },
          status,
          request,
          response,
          findings: shown,
          ...(findings.length === shown.length
            ? {}
            : { cut: `${findings.length - shown.length} more finding(s); raise maxNodes` }),
          ...(traffic === undefined ? {} : { traffic }),
          ...(fields === undefined
            ? {}
            : fields.missing.length + fields.unused.length === 0
              ? {}
              : { fields: { missing: fields.missing, unused: fields.unused } }),
          ...(answer === undefined ? {} : { answer: answer.answer }),
          ...(fields === undefined && answer === undefined ? {} : completeOf([...(fields?.left ?? []), ...(answer?.left ?? [])])),
        }, [...new Set(shapes)].slice(0, 2).map((id) => `get_type({type: ${JSON.stringify(id)}})`));
      }),
  );
};
