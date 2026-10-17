import { askNextOf, isGapId, readAccepted, type GraphNode, type PromptSubject } from '@flowatlas/core';
import { acceptedSplitOf, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { withDocs } from '../query/docs.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { loadObservedCounts } from '../query/observed.js';
import { describeForPrompt, PROMPT_LIMITS } from '../prompt/describe.js';
import {
  fileIdOf,
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
import { findingsOf } from './findings.js';

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
 * surface counts them: demoted where an annotation answered them (P80).
 */
const checkOf = (db: GraphDb, ctx: ToolContext, gapId: string): PromptSubject | undefined => {
  const rows = rowsOfGap(db.allUnresolved(), gapId);
  if (rows.length === 0) return undefined;
  const split = acceptedSplitOf(db, rows, readAccepted(ctx.handle.path));
  return gatherCheckSubject(db, gapId, rowsOfGap(split.rows, gapId));
};

/** `docs` names the blocks about the subject (P120), so the hand-off says which page describes it. */
const answer = (
  id: string,
  subject: PromptSubject,
  input: { maxSteps: number; maxChars: number },
  alsoAnswers?: string[],
  docs: { docs?: unknown[] } = {},
) => {
  const next = askNextOf(subject);
  const markdown = describeForPrompt(subject, { ...PROMPT_LIMITS, maxSteps: input.maxSteps, maxChars: input.maxChars });
  return withNext({ id, ...(alsoAnswers === undefined ? {} : { alsoAnswers }), markdown, ...docs }, next);
};

/**
 * What the class, file and service scopes read beside the graph (P95): run
 * time counts, the crossings `check_contract` lists between two services, and
 * the findings ranked as the `findings` tool ranks them, so the text and the
 * tools never disagree.
 */
const scopeContext = (db: GraphDb, ctx: ToolContext): ScopeContext => {
  const counts = loadObservedCounts(ctx.handle.path);
  return {
    ...(counts === undefined ? {} : { counts }),
    crossings: (from, to) => crossingsBetween(db, from, to),
    findings: (service) =>
      findingsOf(db, ctx, service).ranked.map((row) => ({
        reason: row.kind,
        message: row.message,
        id: row.id,
        ...(row.service === '' ? {} : { service: row.service }),
        ...(row.loc === undefined ? {} : { loc: row.loc }),
      })),
  };
};

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
        id: z.string().describe('any id, gap id, channel or "POST /orders"'),
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
        const subject = gatherPromptSubject(db, found.node, loadObservedCounts(ctx.handle.path));
        return answer(found.node.id, subject, input, found.alsoAnswers, withDocs(db, ctx.handle.path, found.node.id));
      }),
  );
};
