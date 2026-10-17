import { httpVerbOf } from '../adapters/http-clients.js';

/**
 * Guessing what a call of an in-house wrapper is, for a starter rule (P121).
 */

/** Words a method is named by, to the kind of call it usually is. */
const KIND_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['subscribe', /^(on|once|subscribe|listen|consume|handle|addListener|addEventListener|register)$/i],
  ['start', /^(start|run|execute|invoke|launch|startExecution|startWorkflow|kickOff)$/i],
  ['publish', /^(emit|publish|send|dispatch|produce|notify|broadcast|enqueue|push|fire|post|put|add|raise)/i],
  ['table', /^(insert|update|upsert|find|select|remove|delete|query|save|create|get|count|destroy)/i],
];

const HTTP_TYPE = /http|api|client|fetch|rest|request/i;
const DATA_TYPE = /db|data|repo|store|table|sql|dao|collection|model/i;

/**
 * The kind a call is most likely, from its method's name and what it is
 * called on (its type and package, as one string): what `flowatlas patterns
 * suggest` writes into a starter and the MCP `cant_follow` hint drafts one
 * with. A guess for a person to check, `TODO` where the names say nothing.
 */
export const guessPatternKind = (method: string, owner: string): string => {
  if (HTTP_TYPE.test(owner) && (httpVerbOf(method) !== undefined || /^(call|request|send|fetch)$/i.test(method))) return 'http-request';
  if (DATA_TYPE.test(owner)) {
    for (const [kind, words] of KIND_WORDS) if (kind === 'table' && words.test(method)) return 'table';
  }
  for (const [kind, words] of KIND_WORDS) if (kind !== 'table' && words.test(method)) return kind;
  return 'TODO';
};

