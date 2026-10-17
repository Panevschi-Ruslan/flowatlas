import { askNextOf, gapIdOf, isGapId, readAccepted, type GraphNode, type PromptSubject } from '@flowatlas/core';
import { acceptedSplitOf, type AnchoredUnresolvedRow, type FindingRow, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { withDocs } from '../query/docs.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { failuresSeenRef, type FailuresSeenRef } from '../query/fails.js';
import { blindSpotsBeside, failuresSeen, loadObservedCounts } from '../query/observed.js';
import { describeForPrompt, PROMPT_LIMITS } from '../prompt/describe.js';
import {
  fileIdOf,
  findingGapOf,
  gatherCheckSubject,
  gatherFileSubject,
  gatherPromptSubject,
  gatherScopedSubject,
  gatherServiceSubject,
  PROMPT_SCOPES,
  rowsOfGap,
  scopesFor,
  serviceInputOf,
  type PromptScopeName,
  type ScopeContext,
} from '../prompt/gather.js';
import { nearNames } from './entries.js';
import { READ_ONLY, withDb, type ToolContext } from './common.js';
import { crossingsBetween } from './contract.js';
import { rankedFindingsOf } from './findings.js';
import { loadContractBreaks } from '../query/contracts.js';

/**
 * The node an id names: as it is, as a channel without its prefix, or as an
 * entry said aloud. Anything else is a list of near names, never a guess.
 */
const subjectOf = (db: GraphDb, ref: string): { node: GraphNode; alsoAnswers?: string[] } | GraphNode[] => {
  const trimmed = ref.trim();
  const exact = db.node(trimmed) ?? db.node(`channel:${trimmed}`);
  if (exact !== undefined) return { node: exact };
  const entry = resolveEntryRef(db, trimmed);
  if (isResolved(entry)) return { node: entry.node, ...(entry.alsoAnswers === undefined ? {} : { alsoAnswers: entry.alsoAnswers }) };
  if (entry.candidates.length > 0) return entry.candidates;
  return nearNames(db.search(trimmed, { limit: 200 }), trimmed, 5);
};

/**
 * A check by its gap id (`gap:<service>|<file>|<reason>`), its rows as every
 * surface counts them: demoted where an annotation answered them (P80). The
 * blind spots of the observed file beside the database are rows too (P110),
 * so their gap ids are checks, and the repository probably missing is named
 * from the traffic as well as the code (P144). `dbPath` is where the
 * database is, the accepted and observed files beside it; the page's parity
 * test asks the same.
 */
export const checkSubjectAt = (db: GraphDb, dbPath: string, gapId: string): PromptSubject | undefined => {
  const all = [...db.allUnresolved(), ...blindSpotsBeside(dbPath)];
  const rows = rowsOfGap(all, gapId);
  if (rows.length === 0) return undefined;
  const split = acceptedSplitOf(db, rows, readAccepted(dbPath));
  return gatherCheckSubject(db, gapId, rowsOfGap(split.rows, gapId), all);
};

const checkOf = (db: GraphDb, ctx: ToolContext, gapId: string): PromptSubject | undefined => checkSubjectAt(db, ctx.handle.path, gapId);

/** `file:line`, with `service#` in front or not. */
const PLACE = /^(?:([^#\s]+)#)?([^\s#]+):(\d+)$/;

/** The gap ids of the rows written at a place, sorted; none for an id that is no place. */
const gapsAtPlace = (db: GraphDb, ref: string): string[] => {
  const found = PLACE.exec(ref);
  if (found === null) return [];
  const [, service, file, line] = found;
  const ids = db
    .allUnresolved()
    .filter((row) => row.file === file && row.line === Number(line) && (service === undefined || row.service === service))
    .map((row) => gapIdOf({ reason: row.reason, ...(row.service === null ? {} : { service: row.service }), ...(row.file === null ? {} : { file: row.file }) }));
  return [...new Set(ids)].sort();
};

/**
 * `docs` names the blocks about the subject (P120), so the hand-off says which page describes it; `failures` is
 * an entry's run-time comparison (P106), as data beside the text that says it.
 */
const answer = (
  id: string,
  subject: PromptSubject,
  input: { maxSteps: number; maxChars: number },
  alsoAnswers?: string[],
  extra: { docs?: unknown[]; failures?: FailuresSeenRef } = {},
) => {
  const next = askNextOf(subject);
  const markdown = describeForPrompt(subject, { ...PROMPT_LIMITS, maxSteps: input.maxSteps, maxChars: input.maxChars });
  const { docs, failures } = extra;
  return withNext(
    {
      id,
      ...(alsoAnswers === undefined ? {} : { alsoAnswers }),
      markdown,
      ...(docs === undefined ? {} : { docs }),
      ...(failures === undefined ? {} : { failures }),
    },
    next,
  );
};

/**
 * What the class, file and service scopes read beside the graph at `dbPath`
 * (P95): run time counts, the crossings `check_contract` lists between two
 * services, the findings ranked as the `findings` tool ranks them, so the
 * text and the tools never disagree, and the rows nobody accepted (P143).
 * The page's parity test asks the same (P134).
 */
export const promptScopeContext = (db: GraphDb, dbPath: string): ScopeContext => {
  const counts = loadObservedCounts(dbPath);
  let fresh: AnchoredUnresolvedRow[] | undefined;
  const rows = (): AnchoredUnresolvedRow[] => (fresh ??= acceptedSplitOf(db, db.allUnresolved(), readAccepted(dbPath)).fresh);
  let ranked: FindingRow[] | undefined;
  return {
    ...(counts === undefined ? {} : { counts }),
    crossings: (from, to) => crossingsBetween(db, from, to),
    findings: (service) =>
      (ranked ??= rankedFindingsOf(db, rows(), loadContractBreaks(dbPath))).filter((row) => row.service === service).map(findingGapOf),
    rows,
  };
};

const scopeContext = (db: GraphDb, ctx: ToolContext): ScopeContext => promptScopeContext(db, ctx.handle.path);

/** A file said as `service#path`, when nodes are in it. */
const asFile = (db: GraphDb, ref: string): { service: string; file: string } | undefined => {
  const cut = ref.indexOf('#');
  if (cut <= 0) return undefined;
  const service = ref.slice(0, cut);
  const file = ref.slice(cut + 1);
  return db.allNodes().some((node) => node.repo === service && node.file === file) ? { service, file } : undefined;
};

/** The subject at a scope, or an error naming the scopes the node does have. */
const scopedSubject = (
  db: GraphDb,
  ctx: ToolContext,
  ref: string,
  scope: Exclude<PromptScopeName, 'node'>,
): { id: string; subject: PromptSubject } | { error: string; scopes?: string[] } | undefined => {
  const trimmed = ref.trim();
  // A service by its name and a file by `service#path` need no node.
  if (scope === 'service' && db.services().some((service) => service.name === trimmed)) {
    return { id: trimmed, subject: gatherServiceSubject(db, trimmed, serviceInputOf(db, trimmed, scopeContext(db, ctx))) };
  }
  const file = scope === 'file' ? asFile(db, trimmed) : undefined;
  if (file !== undefined) {
    const id = fileIdOf(file.service, file.file);
    return { id, subject: gatherFileSubject(db, file.service, file.file) };
  }
  const found = subjectOf(db, trimmed);
  if (Array.isArray(found)) return undefined;
  const subject = gatherScopedSubject(db, found.node, scope, scopeContext(db, ctx));
  if (subject === undefined) {
    const scopes = scopesFor(db, found.node);
    return {
      error: `scope ${JSON.stringify(scope)} does not fit ${found.node.id} (type ${found.node.type}); it can be written at ${scopes.join(', ')}`,
      scopes,
    };
  }
  return { id: subject.id, subject };
};

export const registerPrompt = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'describe_for_prompt',
    {
      title: 'Describe for a prompt',
      description: 'An entry, channel, symbol, gap, class, file or service as Markdown to hand on; no code.',
      inputSchema: {
        id: z.string().describe('any id, gap id, file:line, channel or "POST /orders"'),
        scope: z.enum(PROMPT_SCOPES).optional(),
        maxSteps: z.number().int().min(1).max(200).default(PROMPT_LIMITS.maxSteps).describe('chain steps'),
        maxChars: z.number().int().min(500).max(40000).default(PROMPT_LIMITS.maxChars),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const trimmed = input.id.trim();
        if (isGapId(trimmed)) {
          const check = checkOf(db, ctx, trimmed);
          return check === undefined ? { error: `no rows answer to ${JSON.stringify(trimmed)}` } : answer(trimmed, check, input);
        }
        // A place as cant_follow and search name one, `file:line` or `service#file:line` (P122): the gap written there.
        const place = db.node(trimmed) === undefined ? gapsAtPlace(db, trimmed) : [];
        if (place.length === 1) {
          const check = checkOf(db, ctx, place[0] as string);
          if (check !== undefined) return answer(place[0] as string, check, input);
        }
        if (place.length > 1) {
          return withNext({ candidates: place }, place.slice(0, MAX_NEXT).map((id) => `describe_for_prompt({id: ${JSON.stringify(id)}})`));
        }
        if (input.scope !== undefined && input.scope !== 'node') {
          const scoped = scopedSubject(db, ctx, trimmed, input.scope);
          if (scoped !== undefined && 'error' in scoped) {
            return { ...scoped, next: (scoped.scopes ?? []).slice(0, MAX_NEXT).map((scope) => `describe_for_prompt({id: ${JSON.stringify(trimmed)}${scope === 'node' ? '' : `, scope: ${JSON.stringify(scope)}`}})`) };
          }
          if (scoped !== undefined) return answer(scoped.id, scoped.subject, input, undefined, withDocs(db, ctx.handle.path, scoped.id));
        }
        const found = subjectOf(db, input.id);
        if (Array.isArray(found)) {
          return found.length === 0
            ? { error: `nothing matches ${JSON.stringify(input.id)}` }
            : withNext(
                { candidates: found.map((node) => projectDetail(node, 1)) },
                found
                  .slice(0, MAX_NEXT)
                  .map((node) => `describe_for_prompt({id: ${JSON.stringify(node.id)}${input.scope === undefined || input.scope === 'node' ? '' : `, scope: ${JSON.stringify(input.scope)}`}})`),
              );
        }
        const counts = loadObservedCounts(ctx.handle.path);
        const subject = gatherPromptSubject(db, found.node, counts);
        // An entry seen at run time carries the comparison as data too (P106), beside the text that says it.
        const compared = counts === undefined ? undefined : failuresSeen(counts, found.node);
        return answer(found.node.id, subject, input, found.alsoAnswers, {
          ...withDocs(db, ctx.handle.path, found.node.id),
          ...(compared === undefined ? {} : { failures: failuresSeenRef(compared) }),
        });
      }),
  );
};
