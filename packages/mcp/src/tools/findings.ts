import { isMessageTypeNode, makeMessageTypeId, readAccepted } from '@flowatlas/core';
import {
  acceptedSplitOf,
  collectFindings,
  compareFindingKinds,
  likelyRenamed,
  precisionOf,
  rankFindings,
  type AnchoredUnresolvedRow,
  type ContractBreak,
  type FindingRow,
  type GraphDb,
  type RuleViolation,
  waysInReaching,
} from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadContractBreaks } from '../query/contracts.js';
import { rulesReportOf } from './rules.js';
import { truncate } from '../query/detail.js';
import { reachReader } from '../query/ways-in.js';
import { channelContract, requestFields } from './fields-contract.js';
import { answerFieldsOf, answerOf } from '../query/answer-fields.js';
import { topField } from '../query/fields.js';
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
  // The request, at the line that sends it: the address to correct.
  'call-to-missing-route': (row) => callOf('get_source', { symbol: row.id }),
  // The crossing, sent against read field by field.
  'field-never-sent': (row) =>
    row.from === undefined ? callOf('check_contract', { channel: row.to }) : callOf('check_contract', { from: row.from, to: row.to }),
  // What the channel's publishes do send, where the renamed type is.
  'type-never-published': (row) => callOf('who_emits', { channel: row.to }),
  // The request's edge: what its client reads of the answer against what the route answers (P391).
  'answer-field-never-returned': (row) => callOf('check_contract', { from: row.from, to: row.to }),
  'unguarded-among-guarded': (row) => callOf('get_flow', { entry: row.id }),
  unguarded: (row) => callOf('get_flow', { entry: row.id }),
  // At the loop's own line: the code a reader is sent to is the loop, not the top of its method.
  'n-plus-one': (row) => callOf('get_source', { symbol: row.id, fromLine: lineOf(row.loc) }),
  'contract-break': (row) => callOf('check_contract', { from: row.id, to: row.to }),
  'one-ended-channel': (row) =>
    callOf(row.message.startsWith('no producer') ? 'who_consumes' : 'who_emits', { channel: row.id }),
  // The rule's name is the message's first word (P114).
  rule: (row) => callOf('check_rules', { rule: row.message.slice(0, row.message.indexOf(':')) }),
  // P388: the route's flow says every status it answers; a setting set and read nowhere is searched for by name.
  'status-never-answered': (row) => (row.to === undefined ? callOf('get_source', { symbol: row.id }) : callOf('get_flow', { entry: row.to })),
  'config-never-read': (row) => callOf('search', { query: row.id.slice(row.id.lastIndexOf('#') + 1) }),
  'bot-handler-untriggered': (row) => callOf('get_flow', { entry: row.id }),
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
  ...(row.from === undefined ? {} : { from: row.from }),
  ...(row.to === undefined ? {} : { to: row.to }),
  ...(row.method === undefined ? {} : { method: row.method }),
  ...(row.service === '' ? {} : { service: row.service }),
  ...(row.loc === undefined ? {} : { loc: row.loc }),
  message: row.message,
  ...(row.severity === undefined ? {} : { severity: row.severity }),
  precision: row.precision,
  ...(row.evidence === undefined ? {} : { evidence: row.evidence }),
  ...(row.fix === undefined ? {} : { fix: row.fix }),
  ...(row.seenBy === undefined ? {} : { seenBy: row.seenBy }),
  rank: row.rank,
  ...(Object.keys(row.reach).length === 0 ? {} : { reach: row.reach }),
  next: shownBy(row),
});

/** The evidence a field read and never sent needs: every sender's shape and every reader was read. */
const FIELD_EVIDENCE = 'every sender on the crossing and every reader of it was read';

/**
 * Fields read that no sender sends (P384, after P368's `missing`): on every
 * channel (type by type where its handlers choose by type) and on the body of
 * every request joined to a route. A defect only where the comparison is
 * complete - every sender's shape read, every reader read - and said with the
 * field sent and never read beside it that it was most likely renamed from.
 * A comparison that is not complete holds its candidates back, with why.
 */
export const fieldFindingsOf = (
  db: GraphDb,
  ctx: ToolContext,
): { rows: FindingRow[]; heldBack: { count: number; why: string } | undefined } => {
  const rows: FindingRow[] = [];
  let held: { count: number; why: string } | undefined;
  const hold = (count: number, why: string): void => {
    held = held === undefined ? { count, why } : { ...held, count: held.count + count };
  };
  const seen = new Set<string>();
  const add = (row: FindingRow): void => {
    const key = `${row.id}|${row.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  const reader = reachReader(db, ctx.handle, 0);
  const channels = db
    .nodesByType('channel')
    .filter((node) => !isMessageTypeNode(node) && db.edgesTo(node.id, ['emits']).length > 0 && db.edgesFrom(node.id, ['consumes']).length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const channel of channels) {
    const answer = channelContract(db, reader, { channel: channel.id, maxNodes: 1000 }) as {
      missing?: Array<{ field: string; id: string; line: number; type?: string; notSentBy?: string[] }>;
      unused?: Array<{ field: string; type?: string }>;
      complete?: boolean;
      left?: string[];
    };
    const missing = answer.missing ?? [];
    if (missing.length === 0) continue;
    if (answer.complete !== true) {
      hold(missing.length, answer.left?.[0] ?? 'the crossing was not read whole');
      continue;
    }
    for (const row of missing) {
      const reading = db.node(row.id);
      const sentInstead = (answer.unused ?? []).filter((each) => each.type === row.type).map((each) => each.field);
      const renamed = likelyRenamed(row.field, sentInstead);
      const crossing = row.type === undefined ? channel.label : `${channel.label} (${row.type})`;
      add({
        kind: 'field-never-sent',
        id: row.id,
        to: row.type === undefined ? channel.id : makeMessageTypeId(channel.id, row.type),
        service: reading?.repo ?? '',
        ...(reading?.file === undefined ? {} : { loc: `${reading.file}:${row.line}` }),
        message:
          `\`${row.field}\` is read by ${reading?.label ?? row.id} on ${crossing} and sent by ` +
          (row.notSentBy === undefined ? 'none of its publishers' : `only some of its publishers (not ${row.notSentBy.join(', ')})`),
        precision: precisionOf('field-never-sent'),
        evidence: FIELD_EVIDENCE,
        ...(renamed === undefined ? {} : { fix: `likely renamed: ${renamed} is sent, ${row.field} is read` }),
        reach: {},
        rank: 0,
      });
    }
  }
  const routes = db.nodesByType('entry', 'http').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const route of routes) {
    for (const edge of db.edgesTo(route.id, ['http_calls', 'hits'])) {
      const compared = requestFields(db, { id: edge.from, params: edge.params }, route.id, undefined);
      if (compared === undefined || compared.missing.length === 0) continue;
      if (compared.left.length > 0) {
        hold(compared.missing.length, compared.left[0]!);
        continue;
      }
      const sender = db.node(edge.from);
      for (const row of compared.missing) {
        const reading = db.node(row.id);
        const renamed = likelyRenamed(row.field, compared.unused.map((each) => each.field));
        add({
          kind: 'field-never-sent',
          id: row.id,
          from: edge.from,
          to: route.id,
          service: reading?.repo ?? route.repo,
          ...(reading?.file === undefined ? {} : { loc: `${reading.file}:${row.line}` }),
          message: `\`${row.field}\` of the body of ${route.label} is read by ${reading?.label ?? row.id} and not sent by ${sender?.repo ?? edge.from}'s request`,
          precision: precisionOf('field-never-sent'),
          evidence: FIELD_EVIDENCE,
          ...(renamed === undefined ? {} : { fix: `likely renamed: ${renamed} is sent, ${row.field} is read` }),
          reach: {},
          rank: 0,
        });
      }
    }
  }
  return { rows, heldBack: held };
};

/** A declared answer as a person writes it: `type:shop#Profile[]` is `Profile[]`. */
const typeSaid = (type: string | undefined): string => (type === undefined ? 'a shape' : type.replace(/type:[^#\s]+#/g, ''));

/** The evidence a field of an answer read and never returned needs: the route's answer was read whole. */
const ANSWER_EVIDENCE = 'the route answers a shape read whole, and the field is not in it';

/**
 * Fields of a route's answer a client reads that the route never returns
 * (P393, after P391's `missing`): for every browser request joined to a
 * route, what its client reads of the answer against the fields the
 * handler's declared return holds. A defect only where that return is a
 * shape read whole (a type, an inline object, a list's or a promise's
 * element); where it is not, the route's reads were not compared and are
 * held back, one count per request, with why. A field read only behind a
 * check that it is there (`?.`, `??`, `if (x)`, `== null`, `'k' in o`, P395)
 * is the client handling its absence: held back, one count per read.
 */
export const answerFindingsOf = (db: GraphDb): { rows: FindingRow[]; heldBack: { count: number; why: string } | undefined } => {
  const rows: FindingRow[] = [];
  /** Each reason a candidate was held back for, with the first such candidate's words: one row per reason in the answer's why. */
  const held = new Map<'shape' | 'guarded', { count: number; why: string }>();
  const hold = (reason: 'shape' | 'guarded', why: string): void => {
    const known = held.get(reason);
    held.set(reason, known === undefined ? { count: 1, why } : { ...known, count: known.count + 1 });
  };
  const routes = db.nodesByType('entry', 'http').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const route of routes) {
    const callers = [...new Set(db.edgesTo(route.id, ['http_calls', 'hits']).map((edge) => edge.from))].sort();
    const fields = answerFieldsOf(db, route.id);
    for (const call of callers) {
      const said = answerOf(db, route.id, undefined, call);
      if (said === undefined) continue;
      if (fields === undefined) {
        // Only a request whose client reads a field by name is a candidate: one that hands the answer on reads none here.
        if (said.answer.reads.length === 0) continue;
        const why = `what ${route.label} answers is not a shape read, so the fields its clients read were not compared`;
        hold('shape', why);
        continue;
      }
      const readTops = new Set(said.answer.reads.map((read) => topField(read.field)));
      const notRead = fields.filter((field) => !readTops.has(field));
      for (const row of said.answer.missing) {
        // Read behind a check that it is there: the client copes without it, so nothing breaks (P395).
        if (row.guarded === true) {
          const why = `\`${row.field}\` is read behind a check that it is there (${db.node(row.id)?.label ?? row.id}, line ${row.line}): the client handles its absence`;
          hold('guarded', why);
          continue;
        }
        const reading = db.node(row.id);
        const file = row.file ?? reading?.file;
        const renamed = likelyRenamed(row.field, notRead);
        const ways = waysInReaching(db, call);
        rows.push({
          kind: 'answer-field-never-returned',
          id: row.id,
          from: call,
          to: route.id,
          service: reading?.repo ?? db.node(call)?.repo ?? '',
          ...(file === undefined ? {} : { loc: `${file}:${row.line}` }),
          message: `\`${row.field}\` of the answer to ${route.label} is read by ${reading?.label ?? row.id} and never returned: ${route.label} answers ${typeSaid(said.answer.type)} (${fields.join(', ')})`,
          precision: precisionOf('answer-field-never-returned'),
          evidence: ANSWER_EVIDENCE,
          fix: renamed === undefined ? `return \`${row.field}\` from ${route.label}, or stop reading it` : `likely renamed: ${renamed} is returned, ${row.field} is read`,
          ...(ways.seenBy.length === 0 ? {} : { seenBy: ways.seenBy }),
          reach: ways.waysIn === 0 ? {} : { waysIn: ways.waysIn },
          rank: 0,
        });
      }
    }
  }
  const reasons = [...held.values()];
  const heldBack =
    reasons.length === 0
      ? undefined
      : { count: reasons.reduce((sum, each) => sum + each.count, 0), why: reasons.map((each) => (reasons.length === 1 ? each.why : `${each.count}: ${each.why}`)).join('; ') };
  return { rows, heldBack };
};

/**
 * Every finding of the project ranked by reach (P95), from the rows nobody
 * accepted (`fresh`), the channels with one end and the contract breaks
 * handed in. The page packs the same list for its service prompt (P134), so
 * the `findings` tool, `describe_for_prompt` and the page rank alike.
 */
export const rankedFindingsOf = (
  db: GraphDb,
  fresh: readonly AnchoredUnresolvedRow[],
  contracts: readonly ContractBreak[],
  rules?: readonly RuleViolation[],
  extra?: readonly FindingRow[],
): FindingRow[] => rankFindings(db, collectedOf(db, fresh, contracts, rules, extra).findings);

/** The findings unranked, and what was held back: the evidence read off every row of the graph (P384). */
const collectedOf = (
  db: GraphDb,
  fresh: readonly AnchoredUnresolvedRow[],
  contracts: readonly ContractBreak[],
  rules?: readonly RuleViolation[],
  extra?: readonly FindingRow[],
) =>
  collectFindings(db, {
    rows: fresh,
    all: db.allUnresolved(),
    report: db.report(),
    contracts,
    ...(rules === undefined ? {} : { rules }),
    ...(extra === undefined ? {} : { extra }),
  });

/**
 * The rows "what looks broken" counts rather than lists (P395): a contract
 * break at warning, an optional field one end may leave out, which can run to
 * more rows than every other kind together. Listed when asked
 * for by severity; counted under `warnings` otherwise, with the call.
 */
export const countedNotListed = (row: FindingRow): boolean => row.kind === 'contract-break' && row.severity === 'warning';

/**
 * Every finding of the project, ranked (P95): the rows nobody accepted, the
 * channels with one end, and the contract breaks the last `flowatlas
 * contracts` wrote beside the database. Ranked over the whole project, then
 * kept to the service asked for, so a row's rank is its place in its kind
 * across the project. `notes` and `accepted` count that service's rows.
 * Contract breaks at warning are counted under `warnings`, not listed,
 * unless a `severity` is asked for, which keeps the rows at that severity.
 */
export const findingsOf = (
  db: GraphDb,
  ctx: ToolContext,
  service?: string,
  severity?: string,
): {
  ranked: FindingRow[];
  notes: Record<string, number>;
  accepted: number;
  heldBack: Record<string, { count: number; why: string }>;
  warnings: Record<string, number>;
} => {
  const split = acceptedSplitOf(db, db.allUnresolved(), readAccepted(ctx.handle.path));
  const rules = rulesReportOf(db, ctx)?.violations;
  const inService = <T extends { service: string | null }>(rows: readonly T[]): T[] =>
    service === undefined ? [...rows] : rows.filter((row) => row.service === service);
  const fields = fieldFindingsOf(db, ctx);
  const answers = answerFindingsOf(db);
  const collected = collectedOf(db, split.fresh, loadContractBreaks(ctx.handle.path), rules, [...fields.rows, ...answers.rows]);
  const heldBack = {
    ...collected.heldBack,
    ...(fields.heldBack === undefined ? {} : { 'field-never-sent': fields.heldBack }),
    ...(answers.heldBack === undefined ? {} : { 'answer-field-never-returned': answers.heldBack }),
  };
  const ranked = inService(rankFindings(db, collected.findings));
  const warnings: Record<string, number> = {};
  if (severity === undefined) {
    for (const row of ranked.filter(countedNotListed)) warnings[row.kind] = (warnings[row.kind] ?? 0) + 1;
  }
  return {
    ranked: severity === undefined ? ranked.filter((row) => !countedNotListed(row)) : ranked.filter((row) => row.severity === severity),
    notes: collectFindings(db, { rows: inService(split.fresh) }).notes,
    accepted: collectFindings(db, { rows: inService(split.accepted), all: db.allUnresolved() }).findings.length,
    heldBack,
    warnings,
  };
};

const findingOutput = z.object({
  kind: z.string(),
  id: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  method: z.string().optional(),
  service: z.string().optional(),
  loc: z.string().optional(),
  message: z.string(),
  severity: z.string().optional(),
  precision: z.string(),
  evidence: z.string().optional(),
  fix: z.string().optional(),
  seenBy: z.array(z.string()).optional(),
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
  heldBack: z.record(z.string(), z.object({ count: z.number(), why: z.string() })).optional(),
  warnings: z.record(z.string(), z.number()).optional(),
  accepted: z.number().optional(),
  note: z.string().optional(),
  next: nextOutput,
};

export const registerFindings = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'findings',
    {
      title: 'What looks broken',
      description: 'What looks broken between the services first, each with its precision and nearest fix; then N+1 loops, unguarded routes.',
      inputSchema: {
        kind: z.string().optional().describe('a kind of finding, or a reason'),
        severity: z.enum(['error', 'warning']).optional().describe('warnings are counted unless asked'),
        service: serviceInput,
        maxNodes: commonInput.maxNodes,
        ...pageInput,
      },
      outputSchema: findingsOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { ranked: scoped, notes, accepted, heldBack, warnings } = findingsOf(db, ctx, input.service, input.severity);
        const kinds = [...new Set(scoped.map((row) => row.kind))].sort(compareFindingKinds);
        const said = {
          ...(Object.keys(notes).length === 0 ? {} : { notes }),
          ...(Object.keys(heldBack).length === 0 ? {} : { heldBack }),
          ...(Object.keys(warnings).length === 0 ? {} : { warnings }),
          ...(accepted === 0 ? {} : { accepted }),
        };
        // The rows counted rather than listed, each kind's by the call that lists them.
        const warningCalls = Object.keys(warnings)
          .filter((kind) => input.kind === undefined || input.kind.trim() === kind)
          .map((kind) => callOf('findings', { kind, severity: 'warning', service: input.service }));

        if (input.kind === undefined) {
          const counts = Object.fromEntries(kinds.map((kind) => [kind, scoped.filter((row) => row.kind === kind).length]));
          const top = Object.fromEntries(
            kinds.map((kind) => [kind, scoped.filter((row) => row.kind === kind).slice(0, FINDINGS_TOP).map(wireFinding)]),
          );
          return withNext(
            { counts, top, ...said },
            [
              ...kinds.filter((kind) => (counts[kind] ?? 0) > FINDINGS_TOP).map((kind) => callOf('findings', { kind, severity: input.severity, service: input.service })),
              ...warningCalls,
            ].slice(0, MAX_NEXT),
          );
        }

        const kind = input.kind.trim();
        const rows = scoped.filter((row) => row.kind === kind);
        if (rows.length === 0 && notes[kind] === undefined && warnings[kind] === undefined) {
          const known = kinds;
          return withNext(
            {
              kind,
              rows: [],
              total: 0,
              ...said,
              note: `no ${kind} findings${known.length === 0 ? '' : `; the kinds found are ${known.join(', ')}`}`,
            },
            nearWords(known, kind, 2).map((near) => callOf('findings', { kind: near, severity: input.severity, service: input.service })),
          );
        }
        const { items, total, truncated, nextOffset } = truncate(rows, input.maxNodes, input.offset);
        const args = { kind, severity: input.severity, service: input.service, maxNodes: input.maxNodes };
        return withNext(
          {
            kind,
            rows: items.map(wireFinding),
            total,
            ...(truncated === undefined ? {} : { truncated }),
            ...(nextOffset === undefined ? {} : { nextOffset }),
            ...said,
          },
          pagedNext({ tool: 'findings', args, nextOffset }, [...warningCalls, ...items.slice(0, 2).map(shownBy)]),
        );
      }),
  );
};
