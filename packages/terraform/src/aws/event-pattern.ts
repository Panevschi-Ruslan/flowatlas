import type { MessagePattern, ValueFilter } from '@flowatlas/core';
import { describe, toJson, type Because, type Value } from '../eval/values.js';

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
 * written and not matched on. A pattern written as a heredoc is JSON text; one written
 * with `jsonencode` is a value, and a reference inside it - a source passed in
 * as a variable nobody set - leaves that field unread rather than the whole
 * pattern.
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
      const inner = (Array.isArray(operand) ? operand : [operand]).map(filterOf);
      return { anythingBut: inner };
    },
  ],
]);

/** One alternative of a field, as written. */
const filterOf = (written: unknown): ValueFilter => {
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

/** A pattern value, as plain JSON, with each reference standing as `null`. */
const loosely = (value: Value): unknown => {
  const exact = toJson(value);
  if (exact !== undefined) return exact;
  if (value.kind === 'list') return value.items.map(loosely);
  if (value.kind === 'object') return Object.fromEntries([...value.entries].map(([key, item]) => [key, loosely(item)]));
  return { unread: describe(value) };
};

/** The pattern a rule's `event_pattern` holds, or why it is not read. */
export const readEventPattern = (value: Value | undefined): MessagePattern | Because | undefined => {
  if (value === undefined || value.kind === 'null') return undefined;
  let json: unknown;
  if (value.kind === 'string') {
    try {
      json = JSON.parse(value.value);
    } catch {
      return { reason: 'not-json', text: 'event_pattern is not JSON' };
    }
  } else if (value.kind === 'unknown' && value.because.reason === 'computed' && value.partial !== undefined) {
    json = loosely(value.partial);
  } else if (value.kind === 'unknown') {
    return value.because;
  } else {
    return { reason: 'not-a-string', text: `event_pattern is ${describe(value)}` };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { reason: 'not-an-object', text: 'event_pattern is not a JSON object' };
  }
  const fields: Record<string, ValueFilter[]> = {};
  const unmatched: Record<string, unknown> = {};
  for (const [field, written] of Object.entries(json as Record<string, unknown>)) {
    if (!Array.isArray(written) || field.startsWith('$')) {
      unmatched[field] = written;
      continue;
    }
    fields[field] = written.map(filterOf);
  }
  return { fields, ...(Object.keys(unmatched).length === 0 ? {} : { unmatched }) };
};
