import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGraphDb } from '@flowatlas/linker';
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
    const path = join(dir, name.file);
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

/** Builds the index from the database beside it and writes it, unless it already says exactly this. */
export const writeEditIndex = (outputDir: string, services: Record<string, string>, builtAt: string): void => {
  const db = openGraphDb(join(outputDir, 'graph.db'), { readonly: true });
  let index: EditIndex;
  try {
    index = editIndexOf(crossingNamesOf(db), services, builtAt, readOrNothing);
  } finally {
    db.close();
  }
  const path = join(outputDir, EDITS_FILE);
  const text = `${JSON.stringify(index)}\n`;
  if (readOrNothing(path) === text) return;
  writeFileSync(path, text, 'utf8');
};
