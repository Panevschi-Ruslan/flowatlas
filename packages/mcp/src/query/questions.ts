import { appendFileSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { gapIdOf, whenFree, type FlowatlasConfig } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';

/**
 * What was asked of the graph, kept on this machine (P235).
 *
 * Off unless the configuration says `log.questions: true` or
 * `FLOWATLAS_LOG_QUESTIONS=1` is set. One line per question: the tool, the ids
 * it was given, whether a name resolved, how big the answer was and what
 * stopped it, the gaps on its path, how long it took. Ids, not prompts: what an
 * assistant was asked never reaches the server, and a search's free text is
 * kept only with `log.text: true` (D2). Nothing here sends anything anywhere;
 * there is no network code in this module, and a test holds that.
 *
 * What it is for is the order gaps are fixed in: `doctor --unresolved` puts
 * first the gaps the most questions ran into, and `stats --questions` says
 * which tools come back empty, cut or unresolved.
 */
export const QUESTIONS_FILE = 'questions.jsonl';
const OLDER_QUESTIONS_FILE = 'questions.1.jsonl';

/** Past this the log is moved aside to `questions.1.jsonl`, so at most two are kept. */
export const DEFAULT_QUESTIONS_BYTES = 5 * 1024 * 1024;

export interface QuestionEntry {
  at: string;
  via: 'mcp' | 'cli';
  tool: string;
  /** The ids and names it was given. */
  ids: string[];
  /** A search's words, only with `log.text: true`. */
  text?: string;
  /** `none` when no name matched, `ambiguous` when several did. */
  resolved: 'found' | 'ambiguous' | 'none';
  /** The answer was an error, for whatever reason. */
  failed: boolean;
  rows: number;
  chars: number;
  stoppedBy: string | null;
  /** The gap ids of the rows on the answer's nodes. */
  gaps: string[];
  reasons: string[];
  empty: boolean;
  stale: boolean;
  ms: number;
  build?: string;
}

export interface QuestionLogSettings {
  enabled: boolean;
  text: boolean;
  maxBytes: number;
}

/** Whether, and how, this project logs its questions. */
export const questionLogSettings = (config: FlowatlasConfig | undefined, env: NodeJS.ProcessEnv = process.env): QuestionLogSettings => ({
  enabled: config?.log?.questions === true || env['FLOWATLAS_LOG_QUESTIONS'] === '1',
  text: config?.log?.text === true,
  maxBytes: config?.log?.maxBytes ?? DEFAULT_QUESTIONS_BYTES,
});

/** The output directory a database is in: the team's pulled graph is asked from `<output>/pulled`, and logged beside the rest. */
const outputDirOf = (dbPath: string): string => (basename(dirname(dbPath)) === 'pulled' ? dirname(dirname(dbPath)) : dirname(dbPath));

/** The log of the output directory a database is in. */
export const questionsPathFor = (dbPath: string): string => join(outputDirOf(dbPath), QUESTIONS_FILE);

/** The arguments that name something, as the tools take them. */
const NAMING_KEYS = ['symbol', 'entry', 'id', 'channel', 'to', 'type', 'edge', 'service', 'cause', 'kind'];

const MAX_IDS = 200;

/** How a failed answer says no name matched. */
const UNRESOLVED = /\bno (?:symbol|node|entry|channel|type|service)\b|\bnot found\b|\bunknown\b|\bmatches nothing\b/i;

/** Every `id` an answer names, bounded. */
const idsIn = (value: unknown, found: Set<string> = new Set(), depth = 0): Set<string> => {
  if (found.size >= MAX_IDS || depth > 64 || value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) idsIn(item, found, depth + 1);
    return found;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['id'] === 'string') found.add(record['id']);
  for (const [key, item] of Object.entries(record)) if (key !== 'next') idsIn(item, found, depth + 1);
  return found;
};

/** One question as a line of the log: what it asked and what came back. */
export const questionOf = (
  input: { via: 'mcp' | 'cli'; tool: string; args: Record<string, unknown>; answer: unknown; chars: number; ms: number; failed: boolean },
  db: GraphDb | undefined,
  settings: Pick<QuestionLogSettings, 'text'>,
): QuestionEntry => {
  const answer = (input.answer ?? {}) as Record<string, unknown>;
  const ids = NAMING_KEYS.flatMap((key) => (typeof input.args[key] === 'string' ? [input.args[key] as string] : []));
  const named = [...idsIn(answer)];
  const rows = db === undefined ? [] : named.flatMap((id) => db.unresolvedFor(id));
  const gaps = [...new Set(rows.map((row) => gapIdOf({ reason: row.reason, ...(row.service === null ? {} : { service: row.service }), ...(row.file === null ? {} : { file: row.file }) })))].sort();
  const stopped = Array.isArray(answer['stoppedBy']) ? String((answer['stoppedBy'] as unknown[])[0] ?? '') : answer['truncated'] !== undefined ? 'truncated' : '';
  const query = typeof input.args['query'] === 'string' ? (input.args['query'] as string) : undefined;
  return {
    at: new Date().toISOString(),
    via: input.via,
    tool: input.tool,
    ids,
    ...(settings.text && query !== undefined ? { text: query } : {}),
    resolved: Array.isArray(answer['candidates']) ? 'ambiguous' : input.failed && UNRESOLVED.test(String(answer['error'] ?? '')) ? 'none' : 'found',
    failed: input.failed,
    rows: named.length,
    chars: input.chars,
    stoppedBy: stopped === '' ? null : stopped,
    gaps,
    reasons: [...new Set(rows.map((row) => row.reason))].sort(),
    empty: !input.failed && named.length === 0,
    stale: answer['stale'] !== undefined,
    ms: input.ms,
    ...(db?.report()?.builtAt === undefined ? {} : { build: db.report()?.builtAt as string }),
  };
};

let rotations = 0;

/**
 * Moves a log past `maxBytes` aside to `questions.1.jsonl`. Several servers
 * can share one output directory, and each may see the same full log: it is
 * first taken under a name only this process uses, so one writer wins and the
 * others find it gone, which means it has been moved already. A file taken
 * that is no longer full is a log another writer has just started; its lines
 * go back to the live log rather than over the older one.
 */
const rotate = (path: string, maxBytes: number): void => {
  try {
    if (statSync(path).size <= maxBytes) return;
  } catch {
    return;
  }
  const taken = join(dirname(path), `${QUESTIONS_FILE}.${process.pid}.${(rotations += 1)}.rotating`);
  // Each move waits out a file another process holds: on Windows a writer
  // appending, or another rotation renaming onto the older file, fails the
  // move for milliseconds, and giving up left the taken file behind.
  try {
    whenFree(() => renameSync(path, taken));
  } catch {
    return;
  }
  try {
    if (statSync(taken).size > maxBytes) {
      whenFree(() => renameSync(taken, join(dirname(path), OLDER_QUESTIONS_FILE)));
      return;
    }
    appendFileSync(path, readFileSync(taken, 'utf8'), 'utf8');
    whenFree(() => unlinkSync(taken));
  } catch {
    // Left under its own name, the file is kept; the live log goes on regardless.
  }
};

/**
 * Appends one question, moving the log aside past `maxBytes`. A log that
 * cannot be moved is still appended to; only a line that cannot be written
 * makes this false.
 */
export const recordQuestion = (dbPath: string, entry: QuestionEntry, maxBytes = DEFAULT_QUESTIONS_BYTES): boolean => {
  const path = questionsPathFor(dbPath);
  rotate(path, maxBytes);
  try {
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
};

/** Every question the log beside a database holds, the older file first; lines that cannot be read are counted. */
export const readQuestions = (dbPath: string): { entries: QuestionEntry[]; unreadable: number } => {
  const entries: QuestionEntry[] = [];
  let unreadable = 0;
  for (const name of [OLDER_QUESTIONS_FILE, QUESTIONS_FILE]) {
    let text: string;
    try {
      text = readFileSync(join(outputDirOf(dbPath), name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        entries.push(JSON.parse(line) as QuestionEntry);
      } catch {
        unreadable += 1;
      }
    }
  }
  return { entries, unreadable };
};

/** How many questions ran into each gap, for `doctor` to order by. */
export const questionsByGap = (entries: readonly QuestionEntry[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const entry of entries) for (const gap of entry.gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  return counts;
};

/** A tool's result as the SDK is handed it: the answer, its size, whether it failed. */
const answerOf = (result: unknown): { answer: unknown; chars: number; failed: boolean } => {
  const value = (result ?? {}) as { content?: Array<{ text?: unknown }>; structuredContent?: unknown; isError?: boolean };
  const text = (value.content ?? []).map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
  let answer = value.structuredContent;
  if (answer === undefined) {
    try {
      answer = JSON.parse(text) as unknown;
    } catch {
      answer = {};
    }
  }
  return { answer, chars: text.length, failed: value.isError === true };
};

/**
 * Runs one tool call, and when the log is on appends what it asked and what
 * came back. The answer is handed on unchanged: the line is written after it
 * is ready, and a log that cannot be written is said once and then left alone.
 */
let unwritable = false;

export const loggedCall = async <T>(
  log: { settings: QuestionLogSettings; dbPath: string; db: () => GraphDb | undefined },
  call: { via: 'mcp' | 'cli'; tool: string; args: Record<string, unknown> },
  run: () => T | Promise<T>,
): Promise<T> => {
  if (!log.settings.enabled || unwritable) return run();
  const started = performance.now();
  const result = await run();
  try {
    const ms = Math.round(performance.now() - started);
    const entry = questionOf({ ...call, ...answerOf(result), ms }, log.db(), log.settings);
    if (!recordQuestion(log.dbPath, entry, log.settings.maxBytes)) {
      // Said once, on stderr, which a stdio client keeps apart from the answers.
      unwritable = true;
      process.stderr.write(`flowatlas: cannot write ${questionsPathFor(log.dbPath)}; questions are not logged for the rest of this run\n`);
    }
  } catch {
    // A question that cannot be summarised is not logged; the answer still goes back.
  }
  return result;
};
