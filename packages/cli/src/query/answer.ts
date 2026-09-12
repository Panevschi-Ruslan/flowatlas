import type { GraphDb } from '@flowatlas/linker';
import type { FlowNode, SourceRoots } from '@flowatlas/mcp';
import { querySettings, type Format, type QueryOptions, type QuerySettings } from '../options.js';
import { getRenderer } from '../render/index.js';
import { repoPalette } from '../render/color.js';
import { collectSource, collectTypes } from './detail.js';

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
}

/** Formats that carry no code, whatever level was asked for. */
const CODELESS = new Set(['mermaid']);

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
    ...(answer.extra === undefined ? {} : { extra: answer.extra }),
    ...(answer.truncated === undefined ? {} : { truncated: answer.truncated }),
  });

  for (const note of notes) io.err(`${note}\n`);
  io.out(text);
};
