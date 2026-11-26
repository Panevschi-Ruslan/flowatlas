import type { DetailLevel, GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { projectDetail } from './detail.js';
import type { ReachReader } from './ways-in.js';

/**
 * Names found by the words of a sentence (P383), ranked, for search and
 * find_symbol.
 *
 * The database finds the rows holding any of the query's words and orders
 * them by how many words the name holds, then how many in all, then BM25
 * (`GraphDb.searchWords`). Only the rows holding as many of the words as the
 * best are kept: "order cancel" is what holds both, where anything does.
 * Among rows holding the same words, facts the database cannot know come
 * before BM25: a way in before the code it runs, a handler before a class,
 * and code that runs before code that may not (the row's `reach`); BM25 then
 * orders what is left alike, a rarer word and a shorter name first. Every row
 * says which words it holds, `matched`, so an answer found this way says why
 * each row is in it.
 */

/** Node types that are the code a question names, after ways in and handlers; anything else after them. */
const KIND_RANK: Readonly<Record<string, number>> = {
  entry: 0,
  consumer: 1,
  method: 2,
  function: 2,
  channel: 3,
  table: 4,
  provider: 4,
  module: 4,
  guard: 4,
  interceptor: 4,
  pipe: 4,
  middleware: 4,
  ui_component: 4,
  type: 5,
};

/** What runs first: a row whose reach is unknown sits between what may run and what does not. */
const REACH_RANK: Readonly<Record<string, number>> = { alive: 0, maybe: 1, outside: 2, unreached: 3, dead: 4 };

/**
 * Node types never a row of a word search: a repository is the service, said
 * on every row already; a site in code (a request, a query, a publish, a
 * template's action, a cache call) is named for what it calls and said by
 * the method it is written in, which is the row.
 */
const NEVER: ReadonlySet<string> = new Set(['repo', 'http_out', 'ui_api_call', 'ui_action', 'db_query', 'producer', 'cache_op']);

/** How many rows past the page are ranked with the page, so a tie at its edge is broken the same way whatever the page. */
const WINDOW = 3;

/** The most rows a word search reads from the database before ranking: past that, `total` says "at least". */
const READ_MAX = 1000;

export interface WordsAsked {
  /** Which nodes may be a row; any but a repository when undefined. */
  admits?: ((node: GraphNode) => boolean) | undefined;
  /** Whether a declared type may be a row. */
  withTypes: boolean;
  service?: string | undefined;
  limit: number;
  offset: number;
  detail: DetailLevel;
  reader?: ReachReader | undefined;
}

export interface WordsFound {
  /** The query's words asked for, stop words dropped. */
  words: string[];
  /** One page of rows, best first, each with `matched`. */
  rows: Array<Record<string, unknown> & { id: string; matched: string[] }>;
  /** Rows holding as many of the words as the best, in all: what the page is cut from. */
  total: number;
  /** Rows holding fewer of the words than the best, left out: a sentence's words are wanted together. */
  fewer: number;
  /** The first row's node, for the calls it leads to. */
  first?: GraphNode;
}

/** The rows holding any of the query's words, ranked (see above), one page of them. */
export const byWords = (db: GraphDb, text: string, asked: WordsAsked): WordsFound => {
  const { words, hits } = db.searchWords(text, { limit: READ_MAX });
  type Candidate = { hit: (typeof hits)[number]; node?: GraphNode; row: Record<string, unknown> & { id: string } };
  const candidates: Candidate[] = [];
  for (const hit of hits) {
    if (hit.of === 'type') {
      if (!asked.withTypes) continue;
      const entry = db.type(hit.id);
      const service = /^type:([^#]+)#/.exec(hit.id)?.[1];
      if (entry === undefined || (asked.service !== undefined && service !== asked.service)) continue;
      candidates.push({ hit, row: { id: hit.id, type: 'type', label: entry.name, ...(service === undefined ? {} : { service }) } });
      continue;
    }
    const node = db.node(hit.id);
    if (node === undefined || NEVER.has(node.type)) continue;
    if (asked.admits !== undefined && !asked.admits(node)) continue;
    if (asked.service !== undefined && node.repo !== asked.service) continue;
    candidates.push({ hit, node, row: projectDetail(node, asked.detail) as unknown as Record<string, unknown> & { id: string } });
  }
  // As many of the words as any row holds: "order cancel" is the rows holding both, where any does.
  const most = Math.max(0, ...candidates.map((candidate) => candidate.hit.matched.length));
  const kept = candidates.filter((candidate) => candidate.hit.matched.length === most);
  // The database's order, then the ties it cannot break, within a window past the page.
  const window = kept.slice(0, (asked.offset + asked.limit) * WINDOW);
  const ranked = window
    .map((candidate) => {
      const row = asked.reader === undefined || candidate.node === undefined ? candidate.row : asked.reader.annotate(candidate.row);
      const reach = typeof (row as { reach?: unknown }).reach === 'string' ? String((row as { reach?: unknown }).reach) : '';
      return {
        candidate,
        row: { ...row, matched: candidate.hit.matched },
        keys: [
          -candidate.hit.inName,
          -candidate.hit.matched.length,
          KIND_RANK[candidate.node?.type ?? 'type'] ?? 6,
          REACH_RANK[reach] ?? 2,
          candidate.hit.score,
          String(candidate.row['label'] ?? '').length,
        ],
      };
    })
    .sort((a, b) => {
      for (let at = 0; at < a.keys.length; at += 1) {
        const diff = (a.keys[at] ?? 0) - (b.keys[at] ?? 0);
        if (diff !== 0) return diff;
      }
      return a.candidate.row.id < b.candidate.row.id ? -1 : a.candidate.row.id > b.candidate.row.id ? 1 : 0;
    });
  const page = ranked.slice(asked.offset, asked.offset + asked.limit);
  const first = page.find((item) => item.candidate.node !== undefined)?.candidate.node;
  return {
    words,
    rows: page.map((item) => item.row),
    total: kept.length,
    fewer: candidates.length - kept.length,
    ...(first === undefined ? {} : { first }),
  };
};

/**
 * What `left` says of an answer found by words: it is ranked, not the one
 * thing named, so never complete (P-7), and how many rows held a word.
 */
export const wordsLeft = (found: Pick<WordsFound, 'words' | 'total' | 'fewer'>, shown: number, offset: number): string =>
  [
    `fuzzy: ranked by the words ${found.words.join(', ')}`,
    ...(found.total > offset + shown ? [`${found.total - offset - shown} more rows hold as many`] : []),
    ...(found.fewer > 0 ? [`${found.fewer} hold fewer`] : []),
  ].join('; ');

/** The most rows a page found by words holds (P-8: the top ten across kinds). */
export const WORDS_PAGE = 10;
