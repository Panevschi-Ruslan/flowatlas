import type { MessagePattern, ValueFilter } from '@flowatlas/core';

/**
 * An EventBridge event pattern, read into filters.
 *
 * A pattern is a filter, not a name: each field it names lists the values an
 * event may have there, and a value is either a literal or a content filter -
 * `{ "prefix": "Loan" }`, `{ "anything-but": [...] }`, `{ "exists": true }`.
 * Every top-level field written as a list of alternatives is read the same
 * way; which of them name a channel is the channel grammar's business, not this
 * reader's, so every one comes back and the grammar picks. A field written as a
 * document of its own - `detail` - and a combinator such as `$or` are kept as
 * written and not matched on.
 *
 * Stated here, over the pattern as plain JSON, because every reader of a
 * deployment meets the same patterns written in its own way - Terraform's
 * heredoc or `jsonencode`, a Serverless Framework file's YAML, a CDK rule's
 * object (P57) - and each hands over the JSON it read.
 */

/** One content filter, by its key. A filter not listed here is kept as written and matches nothing. */
const CONTENT: ReadonlyMap<string, (operand: unknown) => ValueFilter | undefined> = new Map<string, (operand: unknown) => ValueFilter | undefined>([
  ['prefix', (operand: unknown) => (typeof operand === 'string' ? { prefix: operand } : undefined)],
  ['suffix', (operand: unknown) => (typeof operand === 'string' ? { suffix: operand } : undefined)],
  ['equals-ignore-case', (operand: unknown) => (typeof operand === 'string' ? { equalsIgnoreCase: operand } : undefined)],
  ['wildcard', (operand: unknown) => (typeof operand === 'string' ? { wildcard: operand } : undefined)],
  ['exists', (operand: unknown) => (typeof operand === 'boolean' ? { exists: operand } : undefined)],
  [
    'anything-but',
    (operand: unknown) => {
      const inner = (Array.isArray(operand) ? operand : [operand]).map(eventFilterOf);
      return { anythingBut: inner };
    },
  ],
]);

/** One alternative of a field, as written. */
export const eventFilterOf = (written: unknown): ValueFilter => {
  if (typeof written === 'string') return { equals: written };
  if (written !== null && typeof written === 'object' && !Array.isArray(written)) {
    const entries = Object.entries(written as Record<string, unknown>);
    const [only] = entries;
    if (entries.length === 1 && only !== undefined) {
      const read = CONTENT.get(only[0])?.(only[1]);
      if (read !== undefined) return read;
    }
  }
  return { unread: JSON.stringify(written) };
};

/** Why a pattern is not one. */
export interface PatternUnread {
  readonly reason: 'not-an-object';
  readonly text: string;
}

/** The pattern a rule holds, as plain JSON, or why it is not a pattern. */
export const eventPatternOf = (json: unknown): MessagePattern | PatternUnread => {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { reason: 'not-an-object', text: 'the event pattern is not a JSON object' };
  }
  const fields: Record<string, ValueFilter[]> = {};
  const unmatched: Record<string, unknown> = {};
  for (const [field, written] of Object.entries(json as Record<string, unknown>)) {
    if (!Array.isArray(written) || field.startsWith('$')) {
      unmatched[field] = written;
      continue;
    }
    fields[field] = written.map(eventFilterOf);
  }
  return { fields, ...(Object.keys(unmatched).length === 0 ? {} : { unmatched }) };
};
