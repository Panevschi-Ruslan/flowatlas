import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observedPathFor, PROMPT_LIMITS, PROMPT_WALK, readAccepted, readObserved, renderPrompt, type GraphNode, type PromptSubject } from '@flowatlas/core';
import { acceptedSplitOf, openGraphDb, type GraphDb } from '@flowatlas/linker';
import { gatherCheckSubject, gatherClassSubject, gatherFileSubject, gatherPromptSubject, loadObservedCounts, rowsOfGap } from '@flowatlas/mcp';
import { describe, expect, it } from 'vitest';
import { packDatabase } from '../commands/visualise.js';
import { createModel, type GraphModel } from './graph.js';
import { createSeen, promptFor, stepIdOf, subjectOf } from './steps.js';

/**
 * One text for the page and the MCP server (P97): the same subject gathered
 * from the database, as `describe_for_prompt` does, and from the packed page,
 * as "Copy as prompt" does, and written by the one renderer, is the same
 * characters. The three subjects of `fixtures/multi-repo` - a way in, a
 * channel, a check - are snapshots both packages' tests read; every other
 * subject of every fixture whose graph is built is checked for parity alone,
 * and so is every class and every file written whole (P95).
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

/**
 * With traffic beside the graph (P106): the statuses each way in answered
 * against what it declares, gathered from the observed file by the server and
 * from the pack by the page, are the same text. The observed file is the CLI's
 * `observe.json` snapshot, beside a copy of the fixture's database.
 */
describe('a way in seen at run time, the same from both sides (P106)', () => {
  it('writes every way in of the fixture the same with its failures seen', () => {
    const copy = mkdtempSync(join(tmpdir(), 'flowatlas-parity-observed-'));
    try {
      cpSync(join(MULTI_REPO, '.flowatlas'), copy, { recursive: true });
      const dbPath = join(copy, 'graph.db');
      copyFileSync(join(MULTI_REPO, 'expected.cli', 'observe.json'), observedPathFor(dbPath));
      const db = openGraphDb(dbPath, { readonly: true });
      try {
        const observed = readObserved(observedPathFor(dbPath)).observed!;
        const model = createModel(packDatabase(db, readAccepted(dbPath), { observed })) as GraphModel;
        const seen = createSeen(model.data);
        const counts = loadObservedCounts(dbPath);
        let said = 0;
        for (const node of db.nodesByType('entry')) {
          const server = renderPrompt(gatherPromptSubject(db, node, counts), PROMPT_LIMITS);
          const page = promptFor(model, { node: model.nodes.findIndex((_, i) => stepIdOf(model, i) === node.id) }, { ...kit, seen });
          expect({ id: node.id, page }).toEqual({ id: node.id, page: server });
          if (page.includes('## Failures seen at run time')) said += 1;
        }
        expect(said).toBeGreaterThanOrEqual(3);
      } finally {
        db.close();
      }
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});

/**
 * Every class and every file of a fixture, as the server's class and file
 * scopes write them and as the page gathers them (P95): `[server, page]`.
 */
const scopedOf = (sides: Sides, walk = PROMPT_WALK): Array<{ id: string; server: string; page: string }> => {
  const { db, model } = sides;
  const position = new Map(model.nodes.map((_, i) => [stepIdOf(model, i), i]));
  const classes = db.nodesByType('provider').map((node) => ({
    id: `class ${node.id}`,
    server: renderPrompt(gatherClassSubject(db, node, undefined, walk), PROMPT_LIMITS),
    page: promptFor(model, { class: position.get(node.id) ?? -1 }, { ...kit, walk }),
  }));
  const files = [...new Set(db.allNodes().flatMap((node) => (node.file === undefined || node.repo === '' ? [] : [`${node.repo}\u0000${node.file}`])))]
    .sort()
    .map((key) => {
      const [service = '', file = ''] = key.split('\u0000');
      return {
        id: `file ${service}#${file}`,
        server: renderPrompt(gatherFileSubject(db, service, file), PROMPT_LIMITS),
        page: promptFor(model, { file: [service, file] }, { ...kit, walk }),
      };
    });
  return [...classes, ...files];
};

describe('a class and a file written whole, the same from both sides (P95)', () => {
  it('writes every class and every file of the fixture the same, walked in full and cut short', () => {
    const sides = open(MULTI_REPO);
    try {
      let compared = 0;
      for (const walk of [PROMPT_WALK, SHORT]) {
        for (const { id, server, page } of scopedOf(sides, walk)) {
          expect({ id, page }).toEqual({ id, page: server });
          compared += 1;
        }
      }
      expect(compared).toBeGreaterThan(20);
    } finally {
      sides.db.close();
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
        for (const { id, server, page } of scopedOf(sides)) expect({ fixture, id, page }).toEqual({ fixture, id, page: server });
      } finally {
        sides.db.close();
      }
    }
  }, 300_000);
});
