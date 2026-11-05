/**
 * `docs.json`: every doc block a run of `flowatlas docs` read, where it is and
 * what it said (P120). Written beside the graph on every run, so the MCP
 * server and the page can tell an agent or a reader which documents describe
 * the node in front of them, and whether those documents still say what the
 * graph says.
 *
 * The graph stores nothing about docs (I7, I11): this is its own file, with
 * its own version, and a reader that finds it missing or of another version
 * simply knows of no docs.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DOC_KINDS, DOC_STATES, DOC_VIEWS } from './blocks.js';

export const DOCS_FILE = 'docs.json';
/** 2 adds `mentions` and `deadMentions` (P234); a version 1 index is still read, as one that lists none. */
export const DOCS_FORMAT_VERSION = 2;

const optionsSchema = z.strictObject({
  depth: z.number().int().optional(),
  maxNodes: z.number().int().optional(),
  detail: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  service: z.string().optional(),
  sections: z.array(z.string()).optional(),
});

export const docsEntrySchema = z.strictObject({
  /** Relative to the configuration's directory, `/`-separated. */
  file: z.string().min(1),
  line: z.number().int().min(1),
  kind: z.enum(DOC_KINDS),
  /** As written in the marker. */
  id: z.string().min(1),
  /** The node the id resolved to, when it resolved to one. */
  node: z.string().optional(),
  view: z.enum(DOC_VIEWS).optional(),
  options: optionsSchema.optional(),
  state: z.enum(DOC_STATES),
  /** The fingerprint the block's closing marker holds, so a reader can check it against a newer graph. */
  fingerprint: z.string().optional(),
  /** For `gone`: the nearest names. For `ambiguous`: the ids it could mean. */
  near: z.array(z.string()).optional(),
  candidates: z.array(z.string()).optional(),
});

/** A page that names a node in code (P234): where, what it said, the node, the heading above it. */
export const docsMentionSchema = z.strictObject({
  file: z.string().min(1),
  line: z.number().int().min(1),
  text: z.string(),
  node: z.string(),
  /** `mention`: a code span or a plain fence's line; `see`: an `@see` in a doc comment, naming the page. */
  kind: z.enum(['mention', 'see']),
  heading: z.string().optional(),
});

/** A page that names something the graph does not hold any more: a route renamed, a method removed. */
export const docsDeadMentionSchema = z.strictObject({
  file: z.string().min(1),
  line: z.number().int().min(1),
  text: z.string(),
  near: z.array(z.string()),
});

export const docsIndexSchema = z.strictObject({
  docsFormatVersion: z.union([z.literal(1), z.literal(DOCS_FORMAT_VERSION)]),
  mentions: z.array(docsMentionSchema).default([]),
  deadMentions: z.array(docsDeadMentionSchema).default([]),
  /** Markdown files read, relative like `file`, whether or not they hold a block. */
  files: z.array(z.string()),
  blocks: z.array(docsEntrySchema),
  /** Markers that could not be read: `file:line message`. */
  problems: z.array(z.strictObject({ file: z.string(), line: z.number().int(), message: z.string() })),
});

export type DocsEntry = z.infer<typeof docsEntrySchema>;
export type DocsMention = z.infer<typeof docsMentionSchema>;
export type DocsDeadMention = z.infer<typeof docsDeadMentionSchema>;
export type DocsIndex = z.infer<typeof docsIndexSchema>;

/** The index at a path, or why there is none: missing, unreadable, or of another version. */
export const readDocsIndex = (path: string): { index?: DocsIndex; problem?: string } => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = docsIndexSchema.safeParse(JSON.parse(text));
    return parsed.success ? { index: parsed.data } : { problem: `${path} is not a docs index this flowatlas reads (docsFormatVersion ${DOCS_FORMAT_VERSION})` };
  } catch (cause) {
    return { problem: `${path} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};
