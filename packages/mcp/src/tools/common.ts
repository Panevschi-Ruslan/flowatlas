import type { DetailLevel, EntryShapes, GraphEdge } from '@flowatlas/core';
import type { MissingGroup, GraphDb } from '@flowatlas/linker';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CLAMP_NOTE, clampDetail } from '../query/detail.js';
import type { DbHandle } from '../query/db.js';
import { MAX_NEXT } from '../query/next.js';
import { withStale } from '../query/fresh.js';

/**
 * What every tool says about itself (P93): it reads a database built
 * beforehand and writes nothing, touches nothing outside the project, and
 * answers a question asked twice the same way. A client that asks before
 * running a tool that might change something can skip asking.
 */
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;

/**
 * What a tool that thins its rows accepts, so an agent can bound any answer
 * the same way. Undescribed here on purpose (P93): the server's instructions
 * say once what `detail`, `maxNodes`, `offset` and `service` mean, where
 * fifteen copies of the same sentences were most of the tool list.
 */
export const commonInput = {
  detail: z.number().int().min(0).max(3).default(1),
  maxNodes: z.number().int().min(1).max(2000).default(150),
  verbose: z.boolean().optional(),
};

/**
 * Whether to hand the answer over whole (P365): every tool takes it, those
 * that do not spread `commonInput` given it where they are registered. Read
 * where every answer is serialised and never handed to the tool, which
 * answers the same either way; unset or false, the answer is compacted there
 * (`compact.ts`).
 */
export const verboseInput = commonInput.verbose;

/** Where a page of a list starts (P93); a cut answer says the next one. */
export const pageInput = {
  offset: z.number().int().min(0).max(100000).default(0),
};

/** The defaults of the inputs above, so a hint for the next page writes only what was changed. */
export const COMMON_DEFAULTS: Readonly<Record<string, unknown>> = { detail: 1, maxNodes: 150, offset: 0 };

/** The one service filter every list tool takes, said once in the instructions like the rest. */
export const serviceInput = z.string().optional();

/** Whether a node passes the service filter; no filter passes everything. */
export const inService =
  (service: string | undefined) =>
  (node: { repo: string } | undefined): boolean =>
    service === undefined || node?.repo === service;

export interface ToolContext {
  handle: DbHandle;
  /** Filled by the contracts package when one is installed. */
  contractChecker?: ContractChecker;
  /** Filled by the command line, which runs the readers a pattern is tested with (P121). */
  patternTester?: PatternTester;
  /**
   * Filled by the command line (P122): the directories on disk that look like
   * each repository probably missing, by path, aligned with the groups. This
   * package reads no directory, so without it no group has a candidate.
   */
  missingCandidates?: MissingCandidates;
  /** Filled by the contracts package: a route's traffic shapes against its code (P113). */
  trafficChecker?: TrafficChecker;
  /**
   * The tools not listed and when each appears, for `start_here` to say in
   * one line (P201); and a prompt's text without a call to one of them (P360).
   */
  listing?: { hiddenLine(): string | undefined; offeredPrompt?(result: GetPromptResult): GetPromptResult };
}

/** The directories that look like each group's repository, by path, aligned with `groups`. */
export type MissingCandidates = (groups: readonly MissingGroup[]) => string[][];

/** One difference between what traffic carried and what the code declares (P113), as the contracts package says it. */
export interface TrafficDiffSaid {
  kind: string;
  path: string;
  expected: string | null;
  actual: string | null;
  seenIn: number;
  of: number;
  severity: string;
  message: string;
}

/** One direction of a route's traffic, compared. */
export interface TrafficSideSaid {
  against: { typeId: string; by: string; symbol: string; service: string };
  samples: number;
  diffs: TrafficDiffSaid[];
}

/** A route's traffic against its code, as `compareTraffic` answers it; this package reads only these fields. */
export interface TrafficCompared {
  entry: string;
  samples: number;
  lastSeen: string | null;
  request?: TrafficSideSaid;
  responses?: Record<string, TrafficSideSaid>;
  unchecked: Array<{ direction: string; status?: string; reason: string; samples: number }>;
  differs: number;
}

/**
 * Compares a route's traffic shapes with its code (P113). The server does not
 * depend on the contracts package, so the command hands this in, as it does
 * the contract checker; `caller` is the call being checked, whose expected
 * answer stands in when the route declares none.
 */
export type TrafficChecker = (input: { entry: string; shapes: EntryShapes; caller?: GraphEdge }) => TrafficCompared | undefined;

/** What `test_pattern` is asked: rules as YAML, code to run them over, a service to type it in. */
export interface PatternTesterInput {
  yaml: string;
  code?: string;
  service?: string;
}

/** One rule as `test_pattern` answers it: refused, or its own tests and what it makes of the code. */
export interface PatternTesterRule {
  id: string;
  kind?: string;
  refused?: { part: string; reason: string };
  tests: Array<{ code: string; pass: boolean; failures: string[]; drew: string[]; rows: string[] }>;
  code?: { drew: string[]; rows: string[]; holes: Record<string, string>; stoppedAt?: string };
}

export interface PatternTesterAnswer {
  rules: PatternTesterRule[];
  error?: string;
}

/**
 * Runs rules written as YAML by the reader the build runs, in memory: the
 * same tester `flowatlas patterns test` is (P121).
 */
export type PatternTester = (input: PatternTesterInput) => Promise<PatternTesterAnswer>;

/**
 * A field-level finding as `check_contract` sends it (P93).
 *
 * The checker the CLI installs returns the contracts package's finding, which
 * also names the edge, its key and both parties on every row; the answer names
 * the edge once at the top, so the tool sends only these.
 */
export interface ContractFinding {
  severity: string;
  kind: string;
  direction: string;
  field: string;
  expected: string | null;
  actual: string | null;
  message: string;
  /** Set when an annotation or the configuration says the drift is deliberate. */
  ignored?: boolean;
}

export type ContractChecker = (input: {
  edge: { from: string; to: string; type: string };
  left?: { id: string; structuralHash: string };
  right?: { id: string; structuralHash: string };
}) => ContractFinding[];

/** An answer that says it could not answer: `{ error }`, and maybe why. */
const isFailure = (value: object): boolean => typeof (value as { error?: unknown }).error === 'string';

/**
 * The MCP envelope: the payload as one compact JSON document, and the same
 * document as `structuredContent` (P93).
 *
 * The only writer of an answer, so no tool formats JSON itself (D1). The text
 * stays for clients that read only `content`; `structuredContent` is the text
 * read back, so the two can never differ. An answer that is an error carries
 * `isError` and no `structuredContent`: it is not the shape a tool's
 * `outputSchema` declares, and the client would refuse it as that shape.
 */
export const respond = (value: object) => {
  const text = JSON.stringify(value);
  const content = [{ type: 'text' as const, text }];
  if (isFailure(value)) return { content, isError: true };
  return { content, structuredContent: JSON.parse(text) as Record<string, unknown> };
};

export interface Bounded {
  detail: DetailLevel;
  maxNodes: number;
  note?: string;
}

/** Applies the level cap once, so no tool has to remember to. */
export const bound = (input: { detail: number; maxNodes: number }): Bounded => {
  const asked = input.detail as DetailLevel;
  const detail = clampDetail(asked);
  return {
    detail,
    maxNodes: input.maxNodes,
    ...(detail === asked ? {} : { note: CLAMP_NOTE }),
  };
};

/**
 * A call written out the way `next` writes one: `tool({key: value})`, with
 * the arguments left at their defaults left out, so the hint is the shortest
 * call that asks the same thing.
 */
export const callOf = (
  tool: string,
  args: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>> = COMMON_DEFAULTS,
): string => {
  const said = Object.entries(args)
    .filter(([key, value]) => value !== undefined && JSON.stringify(value) !== JSON.stringify(defaults[key]))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `${tool}(${said.length === 0 ? '' : `{${said.join(', ')}}`})`;
};

/**
 * `next` for a list that was cut: the same call at the next page first, then
 * the hints the rows gave, bounded as every `next` is.
 */
export const pagedNext = (
  page: { tool: string; args: Readonly<Record<string, unknown>>; nextOffset: number | undefined },
  hints: readonly string[],
): string[] =>
  page.nextOffset === undefined
    ? [...hints]
    : [callOf(page.tool, { ...page.args, offset: page.nextOffset }), ...hints].slice(0, MAX_NEXT);

/**
 * Runs a tool against the database, or answers with why it could not.
 *
 * A missing or stale database is a sentence the agent can act on, not a crash
 * that takes the server down mid-conversation.
 */
export const withDb = (
  handle: DbHandle,
  run: (db: GraphDb) => object,
): ReturnType<typeof respond> => {
  const opened = handle.open();
  if ('error' in opened) return respond({ error: opened.error });
  try {
    // Every answer that cites a file says when one changed since the build (P230).
    return respond(withStale(handle, run(opened.db)));
  } catch (cause) {
    return respond({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};

/**
 * Whether a list answer is the whole answer (P364): `complete: true` when it
 * holds every row the graph has and nothing on the way was left unread;
 * otherwise `complete: false` and `left`, each thing cut or unread in a few
 * words. The cuts and notes each tool already says (`truncated`,
 * `stoppedBy`, a gap at the top of a chain, a publish whose type was not
 * read) are gathered here, so an agent reads one field to know whether to
 * stop.
 */
export const completeOf = (left: ReadonlyArray<string | undefined | false>): { complete: boolean; left?: string[] } => {
  const said = left.filter((item): item is string => typeof item === 'string' && item !== '');
  return said.length === 0 ? { complete: true } : { complete: false, left: said };
};

/** How a page cut is said in `left`. */
export const pageLeft = (total: number, shown: number, offset: number, nextOffset: number | undefined): string | undefined =>
  nextOffset === undefined ? undefined : `page: ${total - Math.min(offset, total) - shown} more rows from offset ${nextOffset}`;

/** The most inputs one call answers (P364): `ids`, `queries`, `symbols` or `types`. */
export const MAX_ASKED = 20;

/** A list of inputs asked together, beside the single one a tool takes; undescribed, as the instructions say it once. */
export const severalInput = () => z.array(z.string()).min(1).max(MAX_ASKED).optional();

/** The single input and the several, in order, without repeats; none when neither was given. */
export const askedOf = (one: string | undefined, several: readonly string[] | undefined): string[] =>
  [...new Set([...(one === undefined ? [] : [one]), ...(several ?? [])])];

/**
 * Several inputs answered in one answer (P364): each by the tool's own code
 * in turn, bounded as a single one is, under `answers` with the input it
 * answers as `asked` (a key no answer uses: get_type's has a `type`); the
 * hints of all, the first of each first, in one `next`; and `complete`
 * false where any answer is cut or left something unread.
 */
export const answerEach = (key: string, asked: readonly string[], run: (value: string) => object): object => {
  const answers: Array<Record<string, unknown>> = [];
  const hints: string[][] = [];
  for (const value of asked) {
    const { next, ...rest } = run(value) as { next?: string[] } & Record<string, unknown>;
    answers.push({ asked: value, ...rest });
    hints.push(next ?? []);
  }
  const next: string[] = [];
  for (let at = 0; next.length < MAX_NEXT && hints.some((list) => list.length > at); at += 1) {
    for (const list of hints) {
      const hint = list[at];
      if (hint !== undefined && !next.includes(hint) && next.length < MAX_NEXT) next.push(hint);
    }
  }
  const incomplete = answers.filter((answer) => answer['complete'] === false).map((answer) => String(answer['asked']));
  // Said only where the answers say it: a verdict is not a list to be whole.
  const lists = answers.some((answer) => 'complete' in answer);
  return {
    answers,
    ...(lists ? { complete: incomplete.length === 0 } : {}),
    ...(incomplete.length === 0 ? {} : { left: incomplete.map((value) => `${key} ${value}: see its left`) }),
    ...(next.length === 0 ? {} : { next }),
  };
};

/*
 * Pieces of the output schemas (P93), shared so a row is declared once. A
 * schema says what a success answer holds; an error goes out with `isError`
 * and is not checked against it.
 */

/** The calls that take the ids an answer returned. */
export const nextOutput = z.array(z.string()).optional();

/** Whether a row runs and where it is reached from (P364), as `reachReader` says it. */
export const reachOutput = {
  reach: z.enum(['alive', 'unreached', 'dead', 'unknown']).optional(),
  from: z.string().optional(),
  ways: z.number().optional(),
  walkCut: z.literal(true).optional(),
};

/** Whether a list is the whole answer, and what was left if not (P364). */
export const completeOutput = {
  complete: z.boolean().optional(),
  left: z.array(z.string()).optional(),
};

/**
 * A node as it goes over the wire (`CompactNode`). Named, so a schema that
 * holds it twice declares it once under `definitions` and refers to it.
 */
export const nodeOutput = z
  .object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    loc: z.string().optional(),
    service: z.string().optional(),
    kind: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'Node' });

/** A row of code with whether it runs and where it is reached from (P364). */
export const reachedNodeOutput = nodeOutput.extend(reachOutput).meta({ id: 'ReachedNode' });

/** What every cut list says beside its rows. */
export const pageOutput = {
  total: z.number(),
  nextOffset: z.number().optional(),
  truncated: z.string().optional(),
};

/** Several inputs answered together: one answer per input, each the shape a single one has. */
export const answersOutput = z.array(z.record(z.string(), z.unknown())).optional();
