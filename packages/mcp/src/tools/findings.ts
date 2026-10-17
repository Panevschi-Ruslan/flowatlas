import { readAccepted } from '@flowatlas/core';
import {
  acceptedSplitOf,
  collectFindings,
  compareFindingKinds,
  rankFindings,
  type FindingRow,
  type GraphDb,
} from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadContractBreaks } from '../query/contracts.js';
import { rulesReportOf } from './rules.js';
import { truncate } from '../query/detail.js';
import { nearWords } from '../query/names.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import {
  callOf,
  commonInput,
  nextOutput,
  pagedNext,
  pageInput,
  pageOutput,
  READ_ONLY,
  serviceInput,
  withDb,
  type ToolContext,
} from './common.js';

/** How many rows of each kind the answer without a kind holds. */
export const FINDINGS_TOP = 3;

/**
 * The call that shows a finding, by kind (a Strategy): a route's flow, a
 * loop's source, the contract between the two ends, the end of a channel that
 * exists. A kind with none shows the node's source, or searches the gap.
 */
const SHOWN_BY: Readonly<Record<string, (row: FindingRow) => string>> = {
  unguarded: (row) => callOf('get_flow', { entry: row.id }),
  // At the loop's own line: the code a reader is sent to is the loop, not the top of its method.
  'n-plus-one': (row) => callOf('get_source', { symbol: row.id, fromLine: lineOf(row.loc) }),
  'contract-break': (row) => callOf('check_contract', { from: row.id, to: row.to }),
  'one-ended-channel': (row) =>
    callOf(row.message.startsWith('no producer') ? 'who_consumes' : 'who_emits', { channel: row.id }),
  // The rule's name is the message's first word (P114).
  rule: (row) => callOf('check_rules', { rule: row.message.slice(0, row.message.indexOf(':')) }),
};

const lineOf = (loc: string | undefined): number | undefined => {
  const found = /:(\d+)$/.exec(loc ?? '');
  return found === null ? undefined : Number(found[1]);
};

const shownBy = (row: FindingRow): string =>
  (SHOWN_BY[row.kind] ?? ((found: FindingRow) =>
    found.id.startsWith('gap:')
      ? callOf('describe_for_prompt', { id: found.id })
      : callOf('get_source', { symbol: found.id })))(row);

/** A finding as it goes out: the call that shows it beside it, and no empty reach. */
const wireFinding = (row: FindingRow): Record<string, unknown> => ({
  kind: row.kind,
  id: row.id,
  ...(row.to === undefined ? {} : { to: row.to }),
  ...(row.method === undefined ? {} : { method: row.method }),
  ...(row.service === '' ? {} : { service: row.service }),
  ...(row.loc === undefined ? {} : { loc: row.loc }),
  message: row.message,
  ...(row.severity === undefined ? {} : { severity: row.severity }),
  rank: row.rank,
  ...(Object.keys(row.reach).length === 0 ? {} : { reach: row.reach }),
  next: shownBy(row),
});

/**
 * Every finding of the project, ranked (P95): the rows nobody accepted, the
 * channels with one end, and the contract breaks the last `flowatlas
 * contracts` wrote beside the database. Ranked over the whole project, then
 * kept to the service asked for, so a row's rank is its place in its kind
 * across the project. `notes` and `accepted` count that service's rows.
 */
export const findingsOf = (
  db: GraphDb,
  ctx: ToolContext,
  service?: string,
): { ranked: FindingRow[]; notes: Record<string, number>; accepted: number } => {
  const split = acceptedSplitOf(db, db.allUnresolved(), readAccepted(ctx.handle.path));
  const rules = rulesReportOf(db, ctx)?.violations;
  const collected = collectFindings(db, {
    rows: split.fresh,
    report: db.report(),
    contracts: loadContractBreaks(ctx.handle.path),
    ...(rules === undefined ? {} : { rules }),
  });
  const inService = <T extends { service: string | null }>(rows: readonly T[]): T[] =>
    service === undefined ? [...rows] : rows.filter((row) => row.service === service);
  return {
    ranked: inService(rankFindings(db, collected.findings)),
    notes: service === undefined ? collected.notes : collectFindings(db, { rows: inService(split.fresh) }).notes,
    accepted: collectFindings(db, { rows: inService(split.accepted) }).findings.length,
  };
};

const findingOutput = z.object({
  kind: z.string(),
  id: z.string(),
  to: z.string().optional(),
  method: z.string().optional(),
  service: z.string().optional(),
  loc: z.string().optional(),
  message: z.string(),
  severity: z.string().optional(),
  rank: z.number(),
  reach: z.record(z.string(), z.number()).optional(),
  next: z.string(),
});

/** What findings answers: a page of one kind, or each kind counted with its top rows. */
export const findingsOutput = {
  kind: z.string().optional(),
  rows: z.array(findingOutput).optional(),
  ...pageOutput,
  total: z.number().optional(),
  counts: z.record(z.string(), z.number()).optional(),
  top: z.record(z.string(), z.array(findingOutput)).optional(),
  notes: z.record(z.string(), z.number()).optional(),
  accepted: z.number().optional(),
  note: z.string().optional(),
  next: nextOutput,
};

export const registerFindings = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'findings',
    {
      title: 'What to look at',
      description: 'Likely N+1 loops, unguarded routes, contract breaks, one-ended channels, ranked by reach.',
      inputSchema: {
        kind: z.string().optional().describe('n-plus-one, unguarded, contract-break, one-ended-channel, a reason'),
        service: serviceInput,
        maxNodes: commonInput.maxNodes,
        ...pageInput,
      },
      outputSchema: findingsOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { ranked: scoped, notes, accepted } = findingsOf(db, ctx, input.service);
        const kinds = [...new Set(scoped.map((row) => row.kind))].sort(compareFindingKinds);
        const said = {
          ...(Object.keys(notes).length === 0 ? {} : { notes }),
          ...(accepted === 0 ? {} : { accepted }),
        };

        if (input.kind === undefined) {
          const counts = Object.fromEntries(kinds.map((kind) => [kind, scoped.filter((row) => row.kind === kind).length]));
          const top = Object.fromEntries(
            kinds.map((kind) => [kind, scoped.filter((row) => row.kind === kind).slice(0, FINDINGS_TOP).map(wireFinding)]),
          );
          return withNext(
            { counts, top, ...said },
            kinds
              .filter((kind) => (counts[kind] ?? 0) > FINDINGS_TOP)
              .slice(0, MAX_NEXT)
              .map((kind) => callOf('findings', { kind, service: input.service })),
          );
        }

        const kind = input.kind.trim();
        const rows = scoped.filter((row) => row.kind === kind);
        if (rows.length === 0 && notes[kind] === undefined) {
          const known = kinds;
          return withNext(
            {
              kind,
              rows: [],
              total: 0,
              ...said,
              note: `no ${kind} findings${known.length === 0 ? '' : `; the kinds found are ${known.join(', ')}`}`,
            },
            nearWords(known, kind, 2).map((near) => callOf('findings', { kind: near, service: input.service })),
          );
        }
        const { items, total, truncated, nextOffset } = truncate(rows, input.maxNodes, input.offset);
        const args = { kind, service: input.service, maxNodes: input.maxNodes };
        return withNext(
          {
            kind,
            rows: items.map(wireFinding),
            total,
            ...(truncated === undefined ? {} : { truncated }),
            ...(nextOffset === undefined ? {} : { nextOffset }),
            ...said,
          },
          pagedNext({ tool: 'findings', args, nextOffset }, items.slice(0, 2).map(shownBy)),
        );
      }),
  );
};
