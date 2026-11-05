import type { GraphDb } from '@flowatlas/linker';
import { staleFor, type FlowNode, type SourceRoots, type StaleRef } from '@flowatlas/mcp';
import { querySettings, type Format, type QueryOptions, type QuerySettings } from '../options.js';
import { getRenderer } from '../render/index.js';
import type { RenderOptions } from '../render/types.js';
import { repoPalette } from '../render/color.js';
import { collectSource, collectTypes } from './detail.js';
import { dbPathFor } from '../db.js';

/** Where a command's two streams go, so a test can hold them. */
export interface QueryIo {
  out(text: string): void;
  err(text: string): void;
  /** Whether a person is watching, when it is not `process.stdout` that says. */
  tty?: boolean;
}

export const processIo: QueryIo = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
};

/**
 * The flags a command runs with, resolved against wherever its output goes.
 *
 * The terminal decides the default format and whether there is any point in
 * colour, and the terminal is whatever `io` is attached to, so this is the one
 * place the two meet.
 */
export const settingsFor = (
  options: QueryOptions,
  io: QueryIo,
  formats?: readonly Format[],
): QuerySettings =>
  querySettings(options, {
    ...(formats === undefined ? {} : { formats }),
    ...(io.tty === undefined ? {} : { stdout: { isTTY: io.tty } }),
  });

/**
 * One command's answer, before anybody has decided how to draw it.
 *
 * Everything a command knows goes in here and nothing about the format does,
 * which is what makes any detail printable in any format.
 */
export interface Answer {
  tree: FlowNode;
  /** Lines a person sees under the tree. */
  footer?: readonly string[];
  /** Fields a program sees beside the tree. */
  extra?: Record<string, unknown>;
  truncated?: string;
  /** Said on stderr, so a pipe still gets clean data. */
  notes?: readonly string[];
  /** What a sequence reads beside the tree: the edge site of a row and why the walk stops at one (P116). */
  siteOf?: RenderOptions['siteOf'];
  stopOf?: RenderOptions['stopOf'];
  sequenceDetail?: RenderOptions['sequenceDetail'];
}

/** The line a command says when its answer cites files that changed since the build (P230). */
export const staleLine = (stale: StaleRef): string =>
  `built before ${stale.files} of the ${stale.of} files this answer cites changed (${stale.first}${stale.files > 1 ? ' and others' : ''}): run flowatlas build`;

/** Whether an answer's files moved since the build; undefined when they did not, or when nothing can say. */
const staleOfAnswer = (settings: QuerySettings, answer: Answer): StaleRef | undefined => {
  let dbPath: string;
  try {
    dbPath = dbPathFor(settings);
  } catch {
    return undefined;
  }
  return staleFor(dbPath, { tree: answer.tree });
};

/** Formats that carry no code, whatever level was asked for. */
const CODELESS = new Set(['mermaid', 'sequence']);

/**
 * Draws an answer at the level and in the format that were asked for.
 *
 * The single place the two flags meet: detail decides what is fetched, format
 * decides how it is written, and neither reads the other. A format that cannot
 * show code says so on stderr rather than quietly answering a smaller question.
 */
export const present = (
  db: GraphDb,
  settings: QuerySettings,
  answer: Answer,
  io: QueryIo = processIo,
  roots?: SourceRoots,
): void => {
  const notes = [...(answer.notes ?? [])];
  // Built before the code it cites moved (P230): said on stderr, so a pipe
  // still gets clean data, and carried in the data as the tools carry it.
  const stale = staleOfAnswer(settings, answer);
  if (stale !== undefined) notes.push(staleLine(stale));
  const extra = stale === undefined ? answer.extra : { ...answer.extra, stale };
  const codeless = CODELESS.has(settings.format);
  if (settings.detail >= 3 && codeless) notes.push(`source omitted for ${settings.format}`);

  const source =
    codeless || roots === undefined ? {} : collectSource(db, roots, answer.tree, settings.detail);

  const text = getRenderer(settings.format).render(answer.tree, {
    detail: settings.detail,
    color: settings.color,
    ascii: settings.ascii,
    repoPalette: repoPalette(
      db.services().map((service) => service.name),
      settings.color,
    ),
    types: collectTypes(db, answer.tree, settings.detail),
    source,
    ...(answer.footer === undefined ? {} : { footer: answer.footer }),
    ...(extra === undefined ? {} : { extra }),
    ...(answer.truncated === undefined ? {} : { truncated: answer.truncated }),
    ...(answer.siteOf === undefined ? {} : { siteOf: answer.siteOf }),
    ...(answer.stopOf === undefined ? {} : { stopOf: answer.stopOf }),
    ...(answer.sequenceDetail === undefined ? {} : { sequenceDetail: answer.sequenceDetail }),
  });

  for (const note of notes) io.err(`${note}\n`);
  io.out(text);
};
