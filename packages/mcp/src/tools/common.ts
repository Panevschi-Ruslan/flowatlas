import type { DetailLevel } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { z } from 'zod';
import { CLAMP_NOTE, clampDetail } from '../query/detail.js';
import type { DbHandle } from '../query/db.js';
import { MAX_NEXT } from '../query/next.js';

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
};

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
}

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
    return respond(run(opened.db));
  } catch (cause) {
    return respond({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};

/*
 * Pieces of the output schemas (P93), shared so a row is declared once. A
 * schema says what a success answer holds; an error goes out with `isError`
 * and is not checked against it.
 */

/** The calls that take the ids an answer returned. */
export const nextOutput = z.array(z.string()).optional();

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

/** What every cut list says beside its rows. */
export const pageOutput = {
  total: z.number(),
  nextOffset: z.number().optional(),
  truncated: z.string().optional(),
};
