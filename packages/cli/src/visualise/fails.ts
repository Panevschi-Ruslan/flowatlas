import { failuresOf, type Failure, type GraphNode } from '@flowatlas/core';
import { dictionary, wordsOf, type Word } from './dictionary.js';

/**
 * What each way in can fail with, for the page's error card (P68).
 *
 * The shape every reader on the page sees, after `failsByEntry` (graph.js)
 * expands the pack. `at` is the position of the node the failure is written
 * in, or -1 when the graph does not draw it (a helper nothing else puts on the
 * map), in which case `id` names it.
 */
export interface PackedFail {
  /** The status the caller gets back; absent when the code says none. */
  s?: number;
  /** The exception, as the code writes it. */
  x: string;
  at: number;
  id?: string;
  /** Repo-relative file and line of the throw or the check. */
  f?: string;
  l?: number;
  src: Failure['source'];
  /** The status is the framework's default, written nowhere on the path (P87): drawn `500?`. */
  a?: 1;
  /** `x` is a helper that chooses the exception at run time (P90). */
  v?: 'helper';
  /** What the helper can choose, each `{ s?, x, a? }` (P90). */
  ch?: Array<{ s?: number; x: string; a?: 1 }>;
  /** The throw refuses a check of who is asking whose answer was not read (P90). */
  fam?: 'auth';
}

/**
 * What a throw through a helper adds to its record (P90), as the last element:
 * `via`, the choices as `[status, exception]` with a status packed as the
 * record's own is, and `fam`. Absent for every other failure.
 */
export interface PackedFailMore {
  via?: 'helper';
  ch?: Array<[s: number, x: string]>;
  fam?: 'auth';
}

/**
 * One failure as the pack ships it (P84): `[status, exception, at, file, line,
 * source, id?]`. `exception` and `source` are positions in `dicts.exceptions`
 * and `dicts.failSources`, or the word itself where listing it would not pay
 * (`wordsOf`); `file` is a position in `dicts.files`. A status, file or line
 * the code does not say is -1. `id` is there only when `at` is -1. An assumed
 * status (P87) is shipped negated: `-500` is a 500 nothing on the path wrote,
 * which costs one character where a flag would cost a field.
 *
 * A guard's refusal, a pipe's 400 and a shared service's throws stand in front
 * of every route they guard or serve, so the same failure is the same record
 * on all of them, shipped once.
 */
export type PackedFailRecord =
  | [s: number, x: Word, at: number, f: number, l: number, src: Word]
  | [s: number, x: Word, at: number, f: number, l: number, src: Word, id: string]
  | [s: number, x: Word, at: number, f: number, l: number, src: Word, more: PackedFailMore]
  | [s: number, x: Word, at: number, f: number, l: number, src: Word, id: string, more: PackedFailMore];

/** By entry position, the records it fails with, in the order the entry lists them. */
export type PackedFails = Record<number, number[]>;

export interface PackedFailTables {
  fails: PackedFailRecord[];
  exceptions?: string[];
  failSources?: string[];
}

/** Each way in with what it says it fails with, by position; only those that say. */
export const failuresByEntry = (nodes: readonly GraphNode[]): Array<[number, Failure[]]> =>
  nodes.flatMap((node, index): Array<[number, Failure[]]> => {
    if (node.type !== 'entry') return [];
    const fails = failuresOf(node);
    return fails.length === 0 ? [] : [[index, fails]];
  });

type Raw = [s: number, x: string, at: number, f: number, l: number, src: string, ...rest: Array<string | PackedFailMore>];

/** A status as a record packs it: -1 for none, negated where it is assumed. */
const packedStatus = (status: number | undefined, assumed: true | undefined): number =>
  status === undefined ? -1 : assumed === true ? -status : status;

/** What a throw through a helper adds, or nothing for any other failure (P90). */
const moreOf = (item: Failure): PackedFailMore | undefined => {
  if (item.via === undefined && item.chosenFrom === undefined && item.family === undefined) return undefined;
  return {
    ...(item.via === undefined ? {} : { via: item.via }),
    ...(item.chosenFrom === undefined
      ? {}
      : { ch: item.chosenFrom.map((choice): [number, string] => [packedStatus(choice.status, choice.assumed), choice.exception]) }),
    ...(item.family === undefined ? {} : { fam: item.family }),
  };
};

/**
 * The failures, each distinct one once: `fails` lists record positions by
 * entry, `tables` the records and the two dictionaries they index. The files
 * are positions in the page's own file dictionary, which has to hold them.
 */
export const packFails = (
  failed: ReadonlyArray<readonly [number, readonly Failure[]]>,
  position: ReadonlyMap<string, number>,
  fileIx: ReadonlyMap<string, number>,
): { fails: PackedFails; tables: PackedFailTables } | undefined => {
  if (failed.length === 0) return undefined;
  const rawOf = (item: Failure): Raw => {
    const at = position.get(item.at) ?? -1;
    const raw: Raw = [
      packedStatus(item.status, item.assumed),
      item.exception,
      at,
      item.file === undefined ? -1 : (fileIx.get(item.file) ?? -1),
      item.line ?? -1,
      item.source,
    ];
    if (at === -1) raw.push(item.at);
    const more = moreOf(item);
    if (more !== undefined) raw.push(more);
    return raw;
  };
  const records = new Map<string, Raw>();
  const byEntry = failed.map(([index, fails]): [number, string[]] => [
    index,
    fails.map((item) => {
      const raw = rawOf(item);
      const key = JSON.stringify(raw);
      records.set(key, raw);
      return key;
    }),
  ]);
  const [order, recordIx] = dictionary(records.keys());
  const distinct = order.map((key) => records.get(key) as Raw);
  const exceptions = wordsOf(distinct.map(([, x]) => x), 'exceptions');
  const sources = wordsOf(distinct.map(([, , , , , src]) => src), 'failSources');
  const fails: PackedFails = {};
  for (const [index, keys] of byEntry) fails[index] = keys.map((key) => recordIx.get(key) as number);
  return {
    fails,
    tables: {
      fails: distinct.map(
        ([s, x, at, f, l, src, ...rest]) => [s, exceptions.word(x), at, f, l, sources.word(src), ...rest] as PackedFailRecord,
      ),
      ...(exceptions.list.length === 0 ? {} : { exceptions: exceptions.list }),
      ...(sources.list.length === 0 ? {} : { failSources: sources.list }),
    },
  };
};
