import type { DetailLevel } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { z } from 'zod';
import { CLAMP_NOTE, clampDetail } from '../query/detail.js';
import type { DbHandle } from '../query/db.js';

/** What every tool accepts, so an agent can bound any answer the same way. */
export const commonInput = {
  detail: z
    .number()
    .int()
    .min(0)
    .max(3)
    .default(1)
    .describe('0 id only, 1 adds location, 2 adds metadata, 3 is clamped to 2 (use get_source)'),
  maxNodes: z.number().int().positive().max(2000).default(150).describe('most nodes to return'),
};

export interface ToolContext {
  handle: DbHandle;
  /** Filled by the contracts package when one is installed. */
  contractChecker?: ContractChecker;
}

export interface ContractFinding {
  kind: string;
  field?: string;
  message: string;
}

export type ContractChecker = (input: {
  edge: { from: string; to: string; type: string };
  left?: { id: string; structuralHash: string };
  right?: { id: string; structuralHash: string };
}) => ContractFinding[];

/** The MCP content envelope, with the payload as one JSON document. */
export const respond = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

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
 * Runs a tool against the database, or answers with why it could not.
 *
 * A missing or stale database is a sentence the agent can act on, not a crash
 * that takes the server down mid-conversation.
 */
export const withDb = (
  handle: DbHandle,
  run: (db: GraphDb) => unknown,
): ReturnType<typeof respond> => {
  const opened = handle.open();
  if ('error' in opened) return respond({ error: opened.error });
  try {
    return respond(run(opened.db));
  } catch (cause) {
    return respond({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
