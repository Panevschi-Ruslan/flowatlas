import { eventPatternOf } from '@flowatlas/aws';
import type { MessagePattern } from '@flowatlas/core';
import { describe, toJson, type Because, type Value } from '../eval/values.js';

/**
 * An EventBridge event pattern, as Terraform writes it.
 *
 * What a pattern says is read by `eventPatternOf` in `@flowatlas/aws`, which
 * every reader of a deployment shares (P57); this is only how Terraform hands
 * it over. A pattern written as a heredoc is JSON text; one written with
 * `jsonencode` is a value, and a reference inside it - a source passed in as a
 * variable nobody set - leaves that field unread rather than the whole pattern.
 */

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
  const pattern = eventPatternOf(json);
  return 'reason' in pattern ? { reason: pattern.reason, text: 'event_pattern is not a JSON object' } : pattern;
};
