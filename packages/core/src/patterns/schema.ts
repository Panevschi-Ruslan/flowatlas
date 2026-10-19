import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { patternFilesFor, type FlowatlasConfig, type ServiceConfig } from '../config.js';
import { DocumentSyntaxError, readYaml } from '../positioned-document.js';

/**
 * Pattern files: a project's own extraction patterns, written as code (P121).
 *
 * A file is a YAML list of rules. Each rule says what kind of call it
 * describes - a publish, a subscription, a handler's decorator, a request, a
 * start, a table access - which call it is (`on`: the type it is made on, or
 * the function), the call itself as one TypeScript expression with holes
 * (`pattern`), which hole is the name, the address or the payload, and tests
 * beside it that `flowatlas patterns test` runs. Nothing here is executed: a
 * rule is compiled into the descriptions under `adapters` (`compile.ts`) and
 * read by the readers that already read those.
 */

/** What a rule describes; each compiles into one kind of description. */
export const PATTERN_KINDS = ['publish', 'subscribe', 'consume-decorator', 'http-request', 'start', 'table'] as const;

export type PatternKind = (typeof PATTERN_KINDS)[number];

/**
 * The causes of a Can't follow place that a pattern is the usual fix for
 * (P75's causes and reasons): a call on a receiver nothing types, a channel
 * a wrapper hides, a data layer known only by name, a client class nothing
 * follows, a global wrapper installed dynamically. `flowatlas patterns
 * suggest` reads places of these; P122's remedies name the command for them.
 * The one list both read.
 */
export const PATTERN_CAUSES: readonly string[] = [
  'call-dynamic-receiver',
  'channel-dynamic',
  'db-receiver-name-only',
  'api-client-unread',
  'global-wrapper-dynamic',
];

const oneOrMany = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

/** Which call a rule is about, beside what its pattern says. */
const onSchema = z.strictObject({
  /** The type the call is made on: the class or interface of the receiver. */
  receiverType: oneOrMany.optional(),
  /** A function of the project's own, called by its name. */
  function: z.string().min(1).optional(),
  /** The package `function` (or `factory`) is imported from. */
  module: z.string().min(1).optional(),
  /** The function whose call made the receiver: `useApi` of `const api = useApi()`. */
  factory: z.string().min(1).optional(),
});

/** What a test expects of the one call its code holds. */
const expectationSchema = z.union([
  z.literal('none'),
  z.strictObject({
    /** The channel drawn, `*` for one that could not be read. */
    channel: z.string().min(1).optional(),
    /** The verb of a request. */
    verb: z.string().min(1).optional(),
    /** The address of a request, as the graph labels it. */
    url: z.string().min(1).optional(),
    /** The table touched. */
    table: z.string().min(1).optional(),
    /** The deployed name a start reaches. */
    name: z.string().min(1).optional(),
    /** A row the call leaves, by its reason. */
    row: z.string().min(1).optional(),
  }),
]);

export type PatternExpectation = z.infer<typeof expectationSchema>;

const testSchema = z.strictObject({
  /** One statement, a call or a decorated method, as the project writes it. */
  code: z.string().min(1),
  expect: expectationSchema,
});

export type PatternTest = z.infer<typeof testSchema>;

/** A field naming a hole of the pattern, or the value itself. */
const holeOrValue = z.string().min(1);

export const patternRuleSchema = z.strictObject({
  /** How the rule is named in rows, in `meta.describedBy` and on the command line. */
  id: z.string().regex(/^[A-Za-z0-9][\w.-]*$/, 'an id is letters, digits, `.`, `_` and `-`'),
  kind: z.enum(PATTERN_KINDS),
  on: onSchema.default({}),
  /** One TypeScript expression: the call, or `@Decorator(...)` for a decorator. */
  pattern: z.string().min(1),
  /** The hole that names the channel, or the channel itself. */
  channel: holeOrValue.optional(),
  /** The hole the message is written in. */
  payload: holeOrValue.optional(),
  /** The hole that is what runs when a message arrives, for a subscription. */
  handler: holeOrValue.optional(),
  /** The hole that is the address of a request. */
  url: holeOrValue.optional(),
  /** The hole that is the body of a request. */
  body: holeOrValue.optional(),
  /** The hole that is the verb, or the verb every such call sends. */
  verb: holeOrValue.optional(),
  /** The hole that is the deployed name a start reaches. */
  name: holeOrValue.optional(),
  /** For a start: a workflow, or a function by its deployed name. */
  target: z.enum(['workflow', 'invoke']).optional(),
  /** For a start: what the code says, to the name it is deployed under. */
  names: z.record(z.string().min(1), z.string().min(1)).optional(),
  /** The hole that is the table's name, or the table itself. */
  table: holeOrValue.optional(),
  /** For a table: what the call does to it; the method's own name by default. */
  op: z.enum(['read', 'write', 'delete']).optional(),
  /** For a channel: what the transport calls it. `channel` by default. */
  channelKind: z.enum(['topic', 'queue', 'exchange', 'channel']).optional(),
  /** Recorded on the node: `event`, `job`, `rpc`… `event` by default. */
  messageKind: z.string().min(1).optional(),
  /** Why the rule exists, for whoever reads it next. */
  note: z.string().optional(),
  tests: z.array(testSchema).default([]),
});

export type PatternRule = z.infer<typeof patternRuleSchema>;

/** One rule as it was read: where it is written, and the rule or why it is not one. */
export interface RuleReading {
  /** Absolute path of the file. */
  readonly file: string;
  /** The line the rule starts on. */
  readonly line: number;
  /** The id written, when one could be read; a rule refused before its id was read has none. */
  readonly id?: string;
  readonly rule?: PatternRule;
  /** Why the rule is not one: which field, and what is wrong with it. */
  readonly refused?: { readonly part: string; readonly reason: string };
}

/** One pattern file as it was read. */
export interface PatternFileReading {
  /** Absolute path. */
  readonly path: string;
  readonly rules: readonly RuleReading[];
  /** Why nothing of the file was read: it is missing, not YAML, or not a list. */
  readonly problem?: string;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** A zod issue as the part of a rule it is about and what is wrong there. */
const refusalOf = (error: z.ZodError): { part: string; reason: string } => {
  const issue = error.issues[0];
  const part = issue === undefined || issue.path.length === 0 ? 'rule' : issue.path.join('.');
  return { part, reason: issue?.message ?? 'not a rule' };
};

/**
 * Reads one pattern file's text (`undefined` for a file that is not there).
 *
 * Never throws: a file that cannot be read is a problem on the reading, and
 * a rule that does not fit the schema is refused on its own, with the field
 * it is wrong at, so one mistyped rule does not take the rest of the file
 * with it. A second rule with an id already used in the file is refused too.
 */
export const readPatternText = (path: string, text: string | undefined): PatternFileReading => {
  if (text === undefined) return { path, rules: [], problem: 'it is not there' };
  let document;
  try {
    document = readYaml(text);
  } catch (error) {
    const where = error instanceof DocumentSyntaxError ? ` at line ${error.position.line}` : '';
    return { path, rules: [], problem: `it is not YAML${where}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const value = document.value;
  if (value === null || value === undefined) return { path, rules: [] };
  if (!Array.isArray(value)) return { path, rules: [], problem: 'it is not a list of rules' };
  const seen = new Set<string>();
  const rules = value.map((entry: unknown, index): RuleReading => {
    const line = document.at([index])?.line ?? 1;
    const written = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)['id'] : undefined;
    const id = typeof written === 'string' && written !== '' ? written : undefined;
    const parsed = patternRuleSchema.safeParse(entry);
    if (!parsed.success) return { file: path, line, ...(id === undefined ? {} : { id }), refused: refusalOf(parsed.error) };
    if (seen.has(parsed.data.id)) {
      return { file: path, line, id: parsed.data.id, refused: { part: 'id', reason: `${parsed.data.id} is the id of an earlier rule in this file` } };
    }
    seen.add(parsed.data.id);
    return { file: path, line, id: parsed.data.id, rule: parsed.data };
  });
  return { path, rules };
};

/** Reads one pattern file from the disk. */
export const readPatternFile = (path: string): PatternFileReading =>
  readPatternText(path, isFile(path) ? readFileSync(path, 'utf8') : undefined);

/**
 * The pattern files a service reads, read (P121): the project's list and the
 * service's own, each glob expanded against the disk. Nothing without the
 * configuration's directory: a repository read on its own has no project.
 */
export const patternsFor = (
  config: Pick<FlowatlasConfig, 'patterns'> | undefined,
  service: Pick<ServiceConfig, 'patterns'> | undefined,
  configDir: string | undefined,
): PatternFileReading[] =>
  configDir === undefined ? [] : patternFilesFor(config, service, configDir).map(readPatternFile);
