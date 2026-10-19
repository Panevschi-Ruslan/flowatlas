/**
 * The doc blocks a branch makes stale (P120), for `flowatlas diff`.
 *
 * The head side's Markdown is read for blocks, each checked against both
 * graphs: a block that says what the base graph says and not what the head
 * graph says is one this branch makes stale, and the reviewer sees which page
 * to update in the same pull request. A block already stale on the base is
 * counted apart, so the list is about this branch and nothing older.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { LoadedConfig } from '@flowatlas/core';
import type { DocState, GraphDb } from '@flowatlas/linker';
import { checkDocBlock } from '@flowatlas/mcp';
import { docFiles, docsIn } from '../commands/docs.js';
import { sayChange } from '../docs/views.js';

export interface StaleDoc {
  /** Relative to the configuration's directory. */
  file: string;
  line: number;
  kind: string;
  id: string;
  view?: string;
  /** What the head graph says about it. */
  state: DocState;
  /** For `changed`: the steps added and removed, as `flowatlas docs` says them. */
  changes: string[];
  why?: string;
  near?: string[];
}

export interface StaleDocs {
  /** Blocks read on the head side, references included. */
  blocks: number;
  /** Stale on head and true on base: this branch made them so. */
  madeStale: StaleDoc[];
  /** Stale on both sides: older than this branch. */
  alreadyStale: StaleDoc[];
  /** Said when some files could not be read at the head ref. */
  note?: string;
}

const within = (path: string, dir: string): string | undefined => {
  const rel = relative(dir, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? undefined : rel;
};

/**
 * A file as the head side has it: the working tree when the head is the
 * working tree; at the head ref, read from the repository of the service it
 * is in, when one was named. A file in no service's repository has no
 * history this run reads, so it is read as it stands, and said.
 */
const reader = (loaded: LoadedConfig, headRef: string | null) => {
  const untracked: string[] = [];
  const read = (path: string): string | undefined => {
    if (headRef !== null) {
      for (const service of loaded.config.services) {
        const repo = loaded.repoDir(service);
        const rel = within(path, repo);
        if (rel === undefined) continue;
        try {
          return execFileSync('git', ['-C', repo, 'show', `${headRef}:${rel.split(sep).join('/')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        } catch {
          return undefined;
        }
      }
      untracked.push(path);
    }
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  };
  return { read, untracked };
};

/** The head side's doc blocks, checked against both graphs. Nothing is written. */
export const staleDocsOf = (loaded: LoadedConfig, headRef: string | null, dbs: { head: GraphDb; base: GraphDb }): StaleDocs => {
  const { files } = docFiles([], {
    cwd: loaded.rootDir,
    rootDir: loaded.rootDir,
    outputDir: loaded.outputDir,
    ...(loaded.config.docs?.files === undefined ? {} : { configured: loaded.config.docs.files }),
  });
  const { read, untracked } = reader(loaded, headRef);
  const madeStale: StaleDoc[] = [];
  const alreadyStale: StaleDoc[] = [];
  let blocks = 0;
  for (const path of files) {
    const text = read(path);
    if (text === undefined) continue;
    const file = relative(loaded.rootDir, path).split(sep).join('/');
    const { results } = docsIn(dbs.head, file, text);
    blocks += results.length;
    for (const result of results) {
      const { block, check } = result;
      if (check.state === 'ok') continue;
      const stale: StaleDoc = {
        file,
        line: block.line,
        kind: block.kind,
        id: block.id,
        ...(block.view === undefined ? {} : { view: block.view }),
        state: check.state,
        changes: (check.changes ?? []).map((change) => sayChange(change, check.subject)),
        ...(check.why === undefined ? {} : { why: check.why }),
        ...(check.near === undefined ? {} : { near: check.near }),
      };
      (checkDocBlock(dbs.base, block).state === 'ok' ? madeStale : alreadyStale).push(stale);
    }
  }
  return {
    blocks,
    madeStale,
    alreadyStale,
    ...(untracked.length === 0
      ? {}
      : { note: `${untracked.length} doc ${untracked.length === 1 ? 'file is' : 'files are'} in no service's repository and were read from the working tree` }),
  };
};

const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

/**
 * The section of the diff's Markdown: each block the branch makes stale at
 * its `file:line`, with what changed under it, at most `maxRows`; then the
 * blocks that were stale already, in one line. Nothing at all when the
 * project has no doc blocks.
 */
export const staleDocLines = (docs: StaleDocs | undefined, maxRows: number): string[] => {
  if (docs === undefined || docs.blocks === 0) return [];
  const lines = ['## Docs this branch makes stale', ''];
  if (docs.madeStale.length === 0) lines.push(`None of the ${docs.blocks} doc ${docs.blocks === 1 ? 'block goes' : 'blocks go'} stale on this branch.`, '');
  for (const doc of docs.madeStale.slice(0, maxRows)) {
    lines.push(`- \`${doc.file}:${doc.line}\` — ${doc.kind} ${code(doc.id)}${doc.view === undefined ? '' : ` (${doc.view})`}: **${doc.state}**`);
    for (const change of doc.changes) lines.push(`  - ${code(change)}`);
    if (doc.why !== undefined) lines.push(`  - ${doc.why}`);
    if (doc.near !== undefined && doc.near.length > 0) lines.push(`  - nearest: ${doc.near.map(code).join(', ')}`);
  }
  if (docs.madeStale.length > maxRows) lines.push(`- … ${docs.madeStale.length - maxRows} more; \`flowatlas docs --check\` lists every one`);
  if (docs.madeStale.length > 0) lines.push('', 'Run `flowatlas docs --write` on this branch to regenerate them.', '');
  if (docs.alreadyStale.length > 0) {
    lines.push(
      `${docs.alreadyStale.length} more ${docs.alreadyStale.length === 1 ? 'block was' : 'blocks were'} stale before this branch: ${docs.alreadyStale.map((doc) => `\`${doc.file}:${doc.line}\``).join(', ')}.`,
      '',
    );
  }
  if (docs.note !== undefined) lines.push(`_${docs.note}._`, '');
  return lines;
};
