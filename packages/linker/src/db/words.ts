import type Database from 'better-sqlite3';
import type { GraphNode, TypeEntry } from '@flowatlas/core';

/**
 * The words of every name, for a search that takes a sentence (P383).
 *
 * A name is written as code writes it, `OrdersClient.cancel`,
 * `POST /orders/:id/cancel`, `order_created`, `desk-alerts`; a question is
 * written as a person says it, "where is the order cancelled". Each name is
 * split into its words once, camel case, snake case, kebab case and path
 * segments alike, lower case, and stored in an SQLite FTS5 table whose
 * tokenizer stems them (porter): `cancelled` and `cancel`, `payments` and
 * `Payments` meet. A query is split the same way, its stop words dropped, and
 * every word that is left asked for (OR); the rows are ranked by how many of
 * the words they hold in their name, then in all, then by BM25, the name
 * weighted five times its place (service and file). Lexical and
 * deterministic: no embeddings, nothing guessed.
 *
 * Built with the graph (`db_format_version` 3); a database written before
 * that is indexed in memory on its first search, by the same code.
 */

/** The FTS5 table every name's words are stored in. */
export const WORDS_SQL = `CREATE VIRTUAL TABLE words USING fts5(
  id UNINDEXED,       -- the node's id, or the type's
  of UNINDEXED,       -- 'node' or 'type'
  service UNINDEXED,  -- what a service's rebuild deletes by (replaceService)
  name,               -- the name's words: label, path, command, message type, a screen's components
  place,              -- the service's and the file's words
  tokenize = 'porter unicode61'
);`;

/** BM25 weights of the columns, in order: the name five times its place, as code search weighs symbols over files. */
const WEIGHTS = '0, 0, 0, 5, 1';

/**
 * The words of a name written as code writes it, lower case:
 * `OrdersClient.cancel` is `orders client cancel`, `HTTPServer` is
 * `http server`, `order_created` and `desk-alerts` split at the mark.
 */
export const wordsOf = (text: string): string[] =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());

/**
 * Words a question is written with that name nothing in code: what, where,
 * the, is, and the operators a person may type (`OR`, `AND`), since every
 * word left is asked for anyway.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    'a an the and or not of to in on at by for from with into onto over under about as ' +
    'is are was were be been being am do does did done doing has have had having can could will would should shall may might must ' +
    'what where which who whom whose when why how there here this that these those it its they them their i we you he she me my our your ' +
    'any all some each every us please'
  ).split(' '),
);

/**
 * The words a query asks for, each once: stop words and single letters (the
 * `:s` of a path) dropped, or the whole query when it is nothing else.
 */
export const queryWordsOf = (text: string): string[] => {
  const all = [...new Set(wordsOf(text))];
  const asked = all.filter((word) => !STOP_WORDS.has(word) && word.length > 1);
  return asked.length > 0 ? asked : all;
};

/** The meta a node is also named by: a route's path and verb, a command, a message type, the components a screen shows. */
const NAMED_META = ['path', 'method', 'command', 'messageType', 'event', 'topic', 'queue', 'table', 'screens'] as const;

/** The words a node is named by: its label and the meta that names it. */
const nameOf = (node: GraphNode): string => {
  const said: string[] = [node.label];
  for (const key of NAMED_META) {
    const value = node.meta?.[key];
    if (typeof value === 'string') said.push(value);
    else if (Array.isArray(value)) for (const each of value) if (typeof each === 'string') said.push(each);
  }
  return [...new Set(said.flatMap(wordsOf))].join(' ');
};

/** The words of where it is: the service and the file. */
const placeOf = (service: string | null | undefined, file: string | null | undefined): string => wordsOf(`${service ?? ''} ${file ?? ''}`).join(' ');

/** A row of the words table, as stored. */
export interface WordsRow {
  id: string;
  of: 'node' | 'type';
  service: string | null;
  name: string;
  place: string;
}

/** A node's row: `service` is the node's stored service, null for what the whole project owns. */
export const nodeWordsRow = (node: GraphNode, service: string | null): WordsRow => ({
  id: node.id,
  of: 'node',
  service,
  name: nameOf(node),
  place: placeOf(node.repo, node.file),
});

/** A type's row: its name, and the service and file it is declared in. */
export const typeWordsRow = (id: string, entry: Pick<TypeEntry, 'name' | 'declaredIn'>, repo: string | null): WordsRow => ({
  id,
  of: 'type',
  service: repo,
  name: wordsOf(entry.name).join(' '),
  place: placeOf(repo, entry.declaredIn.split('#')[1] ?? entry.declaredIn),
});

/** The insert every writer of the words table uses. */
export const insertWordsOf = (db: Database.Database): ((row: WordsRow) => void) => {
  const statement = db.prepare('INSERT INTO words (id, of, service, name, place) VALUES (?,?,?,?,?)');
  return (row) => {
    statement.run(row.id, row.of, row.service, row.name, row.place);
  };
};

/** One row a word search found, best first. */
export interface WordHit {
  id: string;
  of: 'node' | 'type';
  /** The query's words the row holds, in name or place, in the query's order. */
  matched: string[];
  /** How many of the query's words its name holds. */
  inName: number;
  /** BM25, lower is better: what breaks a tie between rows holding as many words. */
  score: number;
}

/** A word as an FTS5 string: quoted, so no word is read as an operator. */
const quoted = (word: string): string => `"${word.replace(/"/g, '""')}"`;

/**
 * The rows holding any of `words`, best first: the most words in the name,
 * then in all, then by BM25. At most `limit` rows.
 */
export const searchWordsIn = (db: Database.Database, words: readonly string[], limit: number): WordHit[] => {
  if (words.length === 0) return [];
  const rows = db
    .prepare(`SELECT rowid, id, of, bm25(words, ${WEIGHTS}) AS score FROM words WHERE words MATCH ? ORDER BY score, id`)
    .all(words.map(quoted).join(' OR ')) as Array<{ rowid: number; id: string; of: 'node' | 'type'; score: number }>;
  if (rows.length === 0) return [];
  // Which word each row holds, and where: one lookup a word, as small as the query.
  const holding = (column: string, word: string): ReadonlySet<number> =>
    new Set((db.prepare('SELECT rowid FROM words WHERE words MATCH ?').all(`${column}: ${quoted(word)}`) as Array<{ rowid: number }>).map((row) => row.rowid));
  const inName = words.map((word) => holding('name', word));
  const inPlace = words.map((word) => holding('place', word));
  return rows
    .map((row): WordHit => {
      const matched = words.filter((_, index) => inName[index]!.has(row.rowid) || inPlace[index]!.has(row.rowid));
      return { id: row.id, of: row.of, matched, inName: inName.filter((set) => set.has(row.rowid)).length, score: row.score };
    })
    .sort((a, b) => b.inName - a.inName || b.matched.length - a.matched.length || a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
};
