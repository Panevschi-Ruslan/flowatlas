import type { DetailLevel, GraphEdge, GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_NEXT, withNext } from '../query/next.js';
import { bound, callOf, commonInput, nextOutput, pageInput, READ_ONLY, serviceInput, withDb, type ToolContext } from './common.js';
import { referencedIds, resolveTypeRef, typeIdsIn } from './types.js';

/** Which side of an edge names the type: what it takes, or what it gives back. */
export type Carries = 'params' | 'returns';

/** A way in whose handler takes or returns the type. */
export interface EntryUse {
  id: string;
  handler: string;
}

/** An edge that carries the type: a call across services, a publish or a subscription, a call inside one. */
export interface EdgeUse {
  from: string;
  to: string;
  type: string;
  carries: Carries;
}

/** Everything that names one type (P95), grouped by what the use is. */
export interface TypeUses {
  /** Ways in whose handler takes it (the body a route reads). */
  taking: EntryUse[];
  /** Ways in whose handler returns it. */
  returning: EntryUse[];
  /** Requests across services that carry it (`http_calls`, `hits`). */
  crossings: EdgeUse[];
  /** Publishes and subscriptions whose payload it is (`emits`, `consumes`). */
  channels: EdgeUse[];
  /** Calls inside a service that pass or return it. */
  calls: EdgeUse[];
  /** Types that hold it one level down: a field of it, or a type argument. */
  nested: string[];
}

export const TYPE_USE_GROUPS = ['taking', 'returning', 'crossings', 'channels', 'calls'] as const;
type Group = (typeof TYPE_USE_GROUPS)[number];

/** Where each edge type's uses go; `handles` splits into what a way in takes and returns. */
const GROUP_OF_EDGE: Readonly<Record<string, 'crossings' | 'channels' | 'calls'>> = {
  http_calls: 'crossings',
  hits: 'crossings',
  emits: 'channels',
  consumes: 'channels',
  calls: 'calls',
};

const names = (written: readonly string[] | string | undefined, typeId: string): boolean =>
  (typeof written === 'string' ? [written] : (written ?? [])).some((each) => typeIdsIn(each).includes(typeId));

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every use of a type in the graph (P95): each edge whose `params` or
 * `returns` names its id - as `check_contract` reads the two sides of a
 * crossing - grouped by what the edge is, and the types that hold it, so a
 * change to a nested type shows the outer ones too. A type no edge names is
 * used inside one function at most, or not at all; the answer says so.
 */
export const usesOfType = (db: GraphDb, typeId: string): TypeUses => {
  const uses: TypeUses = { taking: [], returning: [], crossings: [], channels: [], calls: [], nested: [] };
  const sides = (edge: GraphEdge): Carries[] => [
    ...(names(edge.params, typeId) ? (['params'] as const) : []),
    ...(names(edge.returns, typeId) ? (['returns'] as const) : []),
  ];
  for (const edge of db.allEdges()) {
    const carried = sides(edge);
    if (carried.length === 0) continue;
    if (edge.type === 'handles') {
      for (const side of carried) (side === 'params' ? uses.taking : uses.returning).push({ id: edge.from, handler: edge.to });
      continue;
    }
    const group = GROUP_OF_EDGE[edge.type];
    if (group === undefined) continue;
    for (const side of carried) uses[group].push({ from: edge.from, to: edge.to, type: edge.type, carries: side });
  }
  for (const list of [uses.taking, uses.returning]) list.sort((a, b) => byKey(a.id, b.id) || byKey(a.handler, b.handler));
  for (const list of [uses.crossings, uses.channels, uses.calls]) {
    list.sort((a, b) => byKey(a.from, b.from) || byKey(a.to, b.to) || byKey(a.carries, b.carries));
  }
  // One level out: a type whose fields or members name it, or whose own id
  // takes it as a type argument (`type:x#Page<type:a#B>`).
  uses.nested = db
    .allTypes()
    .filter((entry) => entry.id !== typeId && (referencedIds(entry).includes(typeId) || typeIdsIn(entry.id).slice(1).includes(typeId)))
    .map((entry) => entry.id)
    .sort(byKey);
  return uses;
};

/** The service a use is in: the way in's, or the sending side's. */
const serviceOfUse = (db: GraphDb, use: EntryUse | EdgeUse): string | undefined =>
  db.node('id' in use ? use.id : use.from)?.repo;

const locOf = (node: GraphNode | undefined): string | undefined =>
  node?.file === undefined ? undefined : node.line === undefined ? node.file : `${node.file}:${node.line}`;

/** A use as it goes out: ids only at 0, then the service and place of the node it starts at. */
const wireUse = (db: GraphDb, use: EntryUse | EdgeUse, detail: DetailLevel): Record<string, unknown> => {
  if (detail <= 0) return { ...use };
  const node = db.node('id' in use ? use.id : use.from);
  const loc = locOf(node);
  return { ...use, ...(node?.repo ? { service: node.repo } : {}), ...(loc === undefined ? {} : { loc }) };
};

const useOutput = z.array(z.record(z.string(), z.unknown()));

/** What type_usage answers: the uses by group, counted, and the types that hold it; or the types a name could mean. */
export const typeUsageOutput = {
  type: z.string().optional(),
  taking: useOutput.optional(),
  returning: useOutput.optional(),
  crossings: useOutput.optional(),
  channels: useOutput.optional(),
  calls: useOutput.optional(),
  nested: z.array(z.string()).optional(),
  counts: z.record(z.string(), z.number()).optional(),
  nextOffset: z.number().optional(),
  truncated: z.string().optional(),
  candidates: z.array(z.string()).optional(),
  note: z.string().optional(),
  next: nextOutput,
};

export const registerTypeUsage = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'type_usage',
    {
      title: 'Who uses this type',
      description: 'What takes or returns a type: ways in, crossings, channels, calls; and the types holding it.',
      inputSchema: {
        type: z.string().describe('type id or name'),
        service: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      outputSchema: typeUsageOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const resolved = resolveTypeRef(db, input.type);
        if ('error' in resolved) return resolved;
        if ('candidates' in resolved) {
          return withNext(
            { candidates: resolved.candidates },
            resolved.candidates.slice(0, MAX_NEXT).map((candidate) => callOf('type_usage', { type: candidate, service: input.service })),
          );
        }
        const typeId = resolved.id;
        const uses = usesOfType(db, typeId);
        const inScope = (use: EntryUse | EdgeUse): boolean => input.service === undefined || serviceOfUse(db, use) === input.service;

        // One offset pages every group, as `search` pages its kinds (P93).
        const counts: Record<string, number> = {};
        const more: Record<string, number> = {};
        const groups: Record<string, Array<Record<string, unknown>>> = {};
        for (const group of TYPE_USE_GROUPS) {
          const rows = (uses[group] as Array<EntryUse | EdgeUse>).filter(inScope);
          counts[group] = rows.length;
          const page = rows.slice(input.offset, input.offset + maxNodes);
          if (rows.length > input.offset + maxNodes) more[group] = rows.length - input.offset - maxNodes;
          if (page.length > 0) groups[group] = page.map((use) => wireUse(db, use, detail));
        }
        const cut = Object.keys(more);
        const nextOffset = cut.length === 0 ? undefined : input.offset + maxNodes;
        const empty = TYPE_USE_GROUPS.every((group) => counts[group] === 0);

        const first = <T>(group: Group): T | undefined => (uses[group] as unknown as T[]).find((use) => inScope(use as EntryUse | EdgeUse));
        const taking = first<EntryUse>('taking') ?? first<EntryUse>('returning');
        const crossing = first<EdgeUse>('crossings');
        const channel = first<EdgeUse>('channels');
        const hints = [
          ...(nextOffset === undefined
            ? []
            : [callOf('type_usage', { type: typeId, service: input.service, detail: input.detail, maxNodes, offset: nextOffset })]),
          ...(taking === undefined ? [] : [callOf('get_flow', { entry: taking.id })]),
          ...(crossing === undefined ? [] : [callOf('check_contract', { from: crossing.from, to: crossing.to })]),
          ...(channel === undefined ? [] : [callOf(channel.type === 'emits' ? 'who_consumes' : 'who_emits', { channel: channel.type === 'emits' ? channel.to : channel.from })]),
          ...uses.nested.slice(0, 1).map((outer) => callOf('type_usage', { type: outer })),
          callOf('get_type', { type: typeId }),
        ];
        return withNext(
          {
            type: typeId,
            ...groups,
            ...(uses.nested.length === 0 ? {} : { nested: uses.nested }),
            counts,
            ...(nextOffset === undefined
              ? {}
              : { nextOffset, truncated: `${cut.map((group) => `${group} ${more[group]!} more`).join(', ')}; next page offset ${nextOffset}` }),
            ...(empty
              ? {
                  note: `no edge names ${typeId}: it is used inside one function at most${uses.nested.length === 0 ? '' : ', or only through the types that hold it'}`,
                }
              : note === undefined
                ? {}
                : { note }),
          },
          hints.slice(0, MAX_NEXT),
        );
      }),
  );
};
