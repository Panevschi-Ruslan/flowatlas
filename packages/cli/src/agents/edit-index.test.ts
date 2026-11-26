import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { editIndexLine } from '../commands/build.js';
import { EDIT_INDEX_REASON, editIndexRows } from '../doctor/edit-index.js';
import { editIndexProblem, failureSaid, writeEditIndexOrSay } from './edit-index.js';
import { EDITS_FILE, type EditIndex } from './edit-match.js';
import { NAMES_FILE } from './names.js';

const BUILT = '2026-01-01T00:00:00.000Z';

/** An output directory holding a one-node graph, as build leaves it before the edit index. */
const outputDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-edits-'));
  const project: ProjectGraph = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: BUILT,
    services: [{ name: 'orders', repo: './orders', type: 'nestjs', extractor: null }],
    nodes: [{ id: 'orders#src/a.ts:A.run', type: 'method', label: 'A.run', repo: 'orders', file: 'src/a.ts', line: 1 }],
    edges: [],
    types: {},
    unresolved: [],
  };
  writeGraphDb(project, { schemaVersion: SCHEMA_VERSION, builtAt: BUILT, configHash: 'test', services: [] } as unknown as LinkReport, join(dir, 'graph.db'));
  writeFileSync(join(dir, NAMES_FILE), '{}\n');
  return dir;
};

const indexAt = (dir: string): EditIndex => JSON.parse(readFileSync(join(dir, EDITS_FILE), 'utf8')) as EditIndex;

/**
 * P396: on a real five-repository project build wrote no `edits.json` and the
 * try around it swallowed why, so the edit hook was silent and nothing said
 * so. The failure is said now: on the build's summary, in the index, and by
 * doctor.
 */
describe('an edit index that could not be written', () => {
  it('is written, and doctor says nothing, when the names are read', () => {
    const dir = outputDir();
    expect(writeEditIndexOrSay(dir, { orders: dir }, BUILT)).toBeUndefined();
    expect(indexAt(dir)).toMatchObject({ builtAt: BUILT, files: {} });
    expect(indexAt(dir).unwritten).toBeUndefined();
    expect(editIndexProblem(dir, BUILT)).toBeUndefined();
    expect(editIndexRows(dir, BUILT)).toEqual([]);
  });

  it('records why in an index with no names, which the build and doctor say', () => {
    const dir = outputDir();
    const overflow = (): never => {
      throw new RangeError('Maximum call stack size exceeded');
    };
    const said = writeEditIndexOrSay(dir, { orders: dir }, BUILT, overflow);
    expect(said).toBe('the reading recursed too deep (Maximum call stack size exceeded)');
    // No names, so the hook stays silent, and the reason with them.
    expect(indexAt(dir)).toMatchObject({ builtAt: BUILT, files: {}, unwritten: said });
    expect(editIndexLine(said)).toContain(`the edit hook's index (${EDITS_FILE}) was not written`);
    expect(editIndexLine(undefined)).toBeUndefined();
    const rows = editIndexRows(dir, BUILT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: EDIT_INDEX_REASON, level: 'info' });
    expect(rows[0]!.message).toContain('recursed too deep');
  });

  it('says a missing index beside the search names, and one older than the graph', () => {
    const dir = outputDir();
    expect(existsSync(join(dir, EDITS_FILE))).toBe(false);
    expect(editIndexProblem(dir, BUILT)).toContain(`${EDITS_FILE} is missing beside ${NAMES_FILE}`);
    writeEditIndexOrSay(dir, { orders: dir }, '2025-12-31T00:00:00.000Z');
    expect(editIndexProblem(dir, BUILT)).toContain('was written for the graph built at 2025-12-31');
    // A directory no build of this version wrote (no search names either) is not asked about.
    expect(editIndexProblem(mkdtempSync(join(tmpdir(), 'flowatlas-none-')), BUILT)).toBeUndefined();
  });

  it('says any other failure by its kind and message', () => {
    expect(failureSaid(new TypeError('x is undefined'))).toBe('TypeError: x is undefined');
    expect(failureSaid('plain')).toBe('plain');
  });
});
