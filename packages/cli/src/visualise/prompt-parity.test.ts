import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_LIMITS, PROMPT_WALK, readAccepted, renderPrompt, type GraphNode, type PromptSubject } from '@flowatlas/core';
import { acceptedSplitOf, openGraphDb, type GraphDb } from '@flowatlas/linker';
import { gatherCheckSubject, gatherPromptSubject, rowsOfGap } from '@flowatlas/mcp';
import { describe, expect, it } from 'vitest';
import { packDatabase } from '../commands/visualise.js';
import { createModel, type GraphModel } from './graph.js';
import { promptFor, stepIdOf, subjectOf } from './steps.js';

/**
 * One text for the page and the MCP server (P97): the same subject gathered
 * from the database, as `describe_for_prompt` does, and from the packed page,
 * as "Copy as prompt" does, and written by the one renderer, is the same
 * characters. The three subjects of `fixtures/multi-repo` - a way in, a
 * channel, a check - are snapshots both packages' tests read; every other
 * subject of every fixture whose graph is built is checked for parity alone.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURES = join(ROOT, 'fixtures');
const MULTI_REPO = join(FIXTURES, 'multi-repo');
const SNAPSHOTS = join(MULTI_REPO, 'expected.prompt');

/** The three subjects the snapshots hold, by the id the server takes. */
const PROMPT_SUBJECTS = {
  entry: 'entry:gateway:http:POST:/orders/:param/invoice',
  channel: 'channel:order.created',
  row: 'gap:web|src/app/orders-api.service.ts|api-path-dynamic',
} as const;

interface Sides {
  db: GraphDb;
  model: GraphModel;
  dbPath: string;
}

const open = (folder: string): Sides => {
  const dbPath = join(folder, '.flowatlas', 'graph.db');
  const db = openGraphDb(dbPath, { readonly: true });
  const model = createModel(packDatabase(db, readAccepted(dbPath))) as GraphModel;
  return { db, model, dbPath };
};

const kit = { walk: PROMPT_WALK, render: renderPrompt, limits: PROMPT_LIMITS };

/** The server's subject for an id: a node, or a gap id's check. */
const serverSubject = ({ db, dbPath }: Sides, id: string, walk = PROMPT_WALK): PromptSubject | undefined => {
  if (id.startsWith('gap:')) {
    const split = acceptedSplitOf(db, rowsOfGap(db.allUnresolved(), id), readAccepted(dbPath));
    return gatherCheckSubject(db, id, rowsOfGap(split.rows, id));
  }
  const node = db.node(id);
  return node === undefined ? undefined : gatherPromptSubject(db, node, undefined, walk);
};

/** The page's target for the same id: a node by position, or the first of the gap's rows. */
const pageTarget = ({ model }: Sides, id: string): { node: number } | { row: number } => {
  if (id.startsWith('gap:')) {
    const { reasons, repos, files } = model.data.dicts;
    const serviceOf = (r: unknown[]): string => (typeof r[1] === 'string' ? r[1] : (r[1] as number) >= 0 ? (repos[r[1] as number] ?? '') : '');
    const row = (model.data.rows ?? []).findIndex(
      (r) => `gap:${serviceOf(r)}|${(r[2] as number) >= 0 ? files[r[2] as number] : ''}|${reasons[r[4] as number]}` === id,
    );
    return { row };
  }
  return { node: model.nodes.findIndex((_, i) => stepIdOf(model, i) === id) };
};

const gapIdsOf = (db: GraphDb): string[] =>
  [...new Set(db.allUnresolved().map((row) => `gap:${row.service ?? ''}|${row.file ?? ''}|${row.reason}`))].sort();

/** The kinds of node a prompt is asked about: ways in, channels, and the code and stores they reach. */
const ASKED = new Set(['entry', 'channel', 'method', 'function', 'consumer', 'producer', 'table']);

/** What every fixture asks of both sides: each node of those kinds, and each gap. */
const subjectsOf = (db: GraphDb): string[] => [
  ...db
    .allNodes()
    .filter((node: GraphNode) => ASKED.has(node.type))
    .map((node) => node.id)
    .sort(),
  ...gapIdsOf(db),
];

/**
 * A walk short enough to be cut on every fixture: what the budget spends its
 * room on first, where a repeat's own row is, and what the depth leaves out
 * are then compared too, not only a walk that reached everything.
 */
const SHORT = { ...PROMPT_WALK, maxNodes: 6, depth: 3 };

const both = (
  sides: Sides,
  id: string,
  walk = PROMPT_WALK,
): { server: string; page: string; subjects: [PromptSubject | undefined, PromptSubject | null] } => {
  const server = serverSubject(sides, id, walk);
  const target = pageTarget(sides, id);
  const page = subjectOf(sides.model, target, { ...kit, walk });
  return {
    server: server === undefined ? '' : renderPrompt(server, PROMPT_LIMITS),
    page: promptFor(sides.model, target, { ...kit, walk }),
    subjects: [server, page],
  };
};

describe('one prompt text for the page and the MCP server (P97)', () => {
  const sides = open(MULTI_REPO);

  for (const [name, id] of Object.entries(PROMPT_SUBJECTS)) {
    it(`writes ${name} the same from the database and from the page, as the shared snapshot has it`, () => {
      const { server, page, subjects } = both(sides, id);
      expect(subjects[1]).toEqual(subjects[0]);
      expect(page).toBe(server);
      expect(page).toBe(readFileSync(join(SNAPSHOTS, `${name}.md`), 'utf8'));
    });
  }

  it('writes every subject of the fixture the same from both sides, walked in full and cut short', () => {
    for (const id of subjectsOf(sides.db)) {
      for (const walk of [PROMPT_WALK, SHORT]) {
        const { server, page, subjects } = both(sides, id, walk);
        expect({ id, page }).toEqual({ id, page: server });
        expect(subjects[1]).toEqual(subjects[0]);
      }
    }
  });
});

describe('the same text on every fixture whose graph is built', () => {
  const built = readdirSync(FIXTURES)
    .map((name) => join(FIXTURES, name))
    .filter((folder) => folder !== MULTI_REPO && existsSync(join(folder, '.flowatlas', 'graph.db')));

  it.skipIf(built.length === 0)('agrees on each way in, channel, symbol and gap', () => {
    for (const folder of built) {
      let sides: Sides;
      try {
        sides = open(folder);
      } catch {
        continue;
      }
      try {
        const fixture = folder.slice(FIXTURES.length + 1);
        for (const id of subjectsOf(sides.db)) {
          for (const walk of [PROMPT_WALK, SHORT]) {
            const { server, page } = both(sides, id, walk);
            expect({ fixture, id, page }).toEqual({ fixture, id, page: server });
          }
        }
      } finally {
        sides.db.close();
      }
    }
  }, 300_000);
});
