import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { openGraphDb, type GraphDb } from '@flowatlas/linker';
import { NAMES_FILE } from './names.js';
import { crossingNamesOf, type CrossingName } from '@flowatlas/mcp';
import { countIn, EDITS_FILE, EDITS_FORMAT_VERSION, fileKey, squeezed, type EditIndex, type EditMatch, type EditName } from './edit-match.js';

/** How many uses a name names; the rest are counted. */
export const USERS_NAMED = 2;

/** How many lines a route's declaration takes, at most, to say it apart from the file's other lines. */
const MOST_LINES = 3;

/**
 * A route's declaration as the file writes it: its line, and the lines after
 * it until the text is the file's only one like it (`@Get()` alone is in most
 * controllers more than once), at most `MOST_LINES`. Undefined where the line
 * is not there or says nothing (`}`).
 */
export const declarationAt = (text: string, line: number): string | undefined => {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return undefined;
  let said = '';
  for (let at = line - 1; at < Math.min(lines.length, line - 1 + MOST_LINES); at += 1) {
    said = said === '' ? (lines[at] as string).trim() : `${said}\n${(lines[at] as string).trim()}`;
    if (squeezed(said).replace(/[\s{}();,]/g, '').length < 3) continue;
    if (countIn(text, { match: 'line', text: said }) === 1) return said;
  }
  return squeezed(said).replace(/[\s{}();,]/g, '').length < 3 ? undefined : said;
};

const matchOf = (name: CrossingName): EditMatch => (name.kind === 'route' ? 'line' : name.kind === 'field' ? 'field' : 'word');

/**
 * The index from the graph just built and the files it was read from: each
 * crossing name with the text an edit would take out and how many times its
 * file holds it now. A name its file does not spell (a channel built from a
 * constant, a route whose line moved) is left out: the hook says nothing it
 * cannot see.
 */
export const editIndexOf = (names: readonly CrossingName[], services: Record<string, string>, builtAt: string, readText: (path: string) => string | undefined): EditIndex => {
  const files: Record<string, EditName[]> = {};
  const texts = new Map<string, string | undefined>();
  for (const name of names) {
    const dir = services[name.service];
    if (dir === undefined) continue;
    const path = posix.join(dir, name.file);
    if (!texts.has(path)) texts.set(path, readText(path));
    const text = texts.get(path);
    if (text === undefined) continue;
    const match = matchOf(name);
    const said = match === 'line' ? declarationAt(text, name.line) : name.literal;
    if (said === undefined) continue;
    const count = countIn(text, { match, text: said });
    if (count === 0) continue;
    const key = fileKey(name.service, name.file);
    const users = [...name.users].sort();
    (files[key] ??= []).push({
      kind: name.kind,
      match,
      text: said,
      count,
      line: name.line,
      said: name.said,
      role: name.role,
      users: users.slice(0, USERS_NAMED),
      ...(users.length > USERS_NAMED ? { more: users.length - USERS_NAMED } : {}),
      id: name.id,
    });
  }
  return { editsFormatVersion: EDITS_FORMAT_VERSION, builtAt, services, files };
};

const readOrNothing = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Writes an index, unless the file already says exactly this. */
const writeIndex = (outputDir: string, index: EditIndex): void => {
  const path = join(outputDir, EDITS_FILE);
  const text = `${JSON.stringify(index)}\n`;
  if (readOrNothing(path) === text) return;
  writeFileSync(path, text, 'utf8');
};

/** Builds the index from the database beside it and writes it, unless it already says exactly this. */
export const writeEditIndex = (outputDir: string, services: Record<string, string>, builtAt: string, names: (db: GraphDb) => readonly CrossingName[] = crossingNamesOf): void => {
  const db = openGraphDb(join(outputDir, 'graph.db'), { readonly: true });
  let index: EditIndex;
  try {
    index = editIndexOf(names(db), services, builtAt, readOrNothing);
  } finally {
    db.close();
  }
  writeIndex(outputDir, index);
};

/** An error as one line: its kind and message, a stack overflow named so (P396). */
export const failureSaid = (error: unknown): string => {
  if (error instanceof RangeError && /call stack/i.test(error.message)) return `the reading recursed too deep (${error.message})`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
};

/**
 * The index written, or, where building it fails, an index with no names
 * that says why (P396), and the reason returned for the build to say. A
 * failure used to be swallowed whole: on a real five-repository project no
 * `edits.json` appeared, nothing said why, and the hook stayed silent.
 */
export const writeEditIndexOrSay = (
  outputDir: string,
  services: Record<string, string>,
  builtAt: string,
  names: (db: GraphDb) => readonly CrossingName[] = crossingNamesOf,
): string | undefined => {
  try {
    writeEditIndex(outputDir, services, builtAt, names);
    return undefined;
  } catch (error) {
    const said = failureSaid(error);
    try {
      writeIndex(outputDir, { editsFormatVersion: EDITS_FORMAT_VERSION, builtAt, services, files: {}, unwritten: said });
    } catch {
      // An output directory that takes no file: the build says why all the same.
    }
    return said;
  }
};

/**
 * What `doctor` says about the edit index beside a graph (P396): nothing where
 * it was written for this graph; why, where the build recorded a failure; and
 * that it is missing or older than the graph, where the build wrote the
 * search hook's names beside it and not it. A directory with neither file is
 * one no build of this version wrote, and is not asked about.
 */
export const editIndexProblem = (outputDir: string, builtAt: string | undefined): string | undefined => {
  const text = readOrNothing(join(outputDir, EDITS_FILE));
  if (text === undefined) return existsSync(join(outputDir, NAMES_FILE)) ? `${EDITS_FILE} is missing beside ${NAMES_FILE}: the build that wrote the graph did not write it` : undefined;
  let index: Partial<EditIndex>;
  try {
    index = JSON.parse(text) as Partial<EditIndex>;
  } catch {
    return `${EDITS_FILE} cannot be read as JSON`;
  }
  if (typeof index.unwritten === 'string') return `the build could not write it: ${index.unwritten}`;
  if (builtAt !== undefined && index.builtAt !== builtAt) return `${EDITS_FILE} was written for the graph built at ${String(index.builtAt)}, not this one (${builtAt})`;
  return undefined;
};
