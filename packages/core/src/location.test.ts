import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { DECLARED_IN, declaredAt, exportSiteIn, reachHere, reachMeta, reachOf } from './location.js';

/** Where the work is written: one declaration far down a long file. */
const TARGET = `
const first = 1;
const second = 2;
const third = 3;

export const POST = async (): Promise<string> => 'made';

export const HIDDEN = async (): Promise<string> => 'hidden';

const written = async (): Promise<string> => 'written';
export default written;
`;

/** Every way a module hands on something it did not write. */
const FORWARDED = `export { POST } from './target';
export { POST as PATCH } from './target';
export { default } from './target';
export * from './target';
`;

/** The ordinary case: written where it is exported. */
const HERE = `
export const GET = async (): Promise<string> => 'here';
`;

let forwarded: SourceFile;
let here: SourceFile;
let target: SourceFile;

const declarationIn = (file: SourceFile, name: string) => {
  const [declaration] = file.getExportedDeclarations().get(name) ?? [];
  if (declaration === undefined) throw new Error(`nothing exported as ${name}`);
  return declaration;
};

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true });
  target = project.createSourceFile('target.ts', TARGET);
  forwarded = project.createSourceFile('route.ts', FORWARDED);
  here = project.createSourceFile('own.ts', HERE);
});

describe('the line a name leaves a file on', () => {
  it('reads a name a specifier forwards', () => {
    expect(exportSiteIn(forwarded, 'POST')).toBe(1);
  });

  it('reads the name a specifier renames it to, not the one it was written as', () => {
    expect(exportSiteIn(forwarded, 'PATCH')).toBe(2);
  });

  it('reads a forwarded default', () => {
    expect(exportSiteIn(forwarded, 'default')).toBe(3);
  });

  it('falls back to a star for a name no specifier mentions', () => {
    // `HIDDEN` reaches this module only through `export *`, and that line is
    // where it leaves the file. Fourth, not first: the specifiers are asked
    // first, so a name written both ways answers with the specifier.
    expect(exportSiteIn(forwarded, 'HIDDEN')).toBe(4);
  });

  it('answers nothing for a name the file does not carry', () => {
    expect(exportSiteIn(here, 'POST')).toBeUndefined();
  });
});

describe('where a thing was written against where it was reached', () => {
  it('keeps the two apart for a name forwarded from another file', () => {
    const reach = reachOf(declarationIn(forwarded, 'POST'), forwarded, 'POST', '/');
    expect(reach.declared).toEqual({ file: 'target.ts', line: 6 });
    expect(reach.reached).toEqual({ file: 'route.ts', line: 1 });
  });

  it('never takes the line from one file and the path from the other', () => {
    // The whole of R99 in one assertion. Before the fix the pair recorded was
    // `route.ts:6`: the file being read and the line of a declaration in another
    // file, which is a position that does not exist in a four-line file.
    const reach = reachOf(declarationIn(forwarded, 'POST'), forwarded, 'POST', '/');
    expect(reach.reached.line).not.toBe(reach.declared.line);
    expect(target.getEndLineNumber()).toBeGreaterThan(forwarded.getEndLineNumber());
    expect(reach.reached.line).toBeLessThanOrEqual(forwarded.getEndLineNumber());
    expect(reach.declared.line).toBeLessThanOrEqual(target.getEndLineNumber());
  });

  it('gives one answer twice for a thing written where it was found', () => {
    const reach = reachOf(declarationIn(here, 'GET'), here, 'GET', '/');
    expect(reach.reached).toEqual(reach.declared);
    expect(reach.reached).toEqual({ file: 'own.ts', line: 2 });
  });

  it('records the declaration in metadata only when it is somewhere else', () => {
    expect(reachMeta(reachOf(declarationIn(here, 'GET'), here, 'GET', '/'))).toEqual({});
    expect(reachMeta(reachOf(declarationIn(forwarded, 'POST'), forwarded, 'POST', '/'))).toEqual({
      declaredIn: 'target.ts',
      declaredLine: 6,
    });
  });

  it('answers both questions of a node without the caller knowing which it has', () => {
    const forwardedNode = {
      file: 'route.ts',
      line: 1,
      meta: reachMeta(reachOf(declarationIn(forwarded, 'POST'), forwarded, 'POST', '/')),
    };
    const ownNode = { file: 'own.ts', line: 2, meta: reachMeta(reachHere('own.ts', 2)) };
    expect(declaredAt(forwardedNode)).toEqual({ file: 'target.ts', line: 6 });
    expect(declaredAt(ownNode)).toEqual({ file: 'own.ts', line: 2 });
  });
});

/**
 * The gate for the class of defect rather than for the one instance.
 *
 * A snapshot records a `file` and a `line` and never checks that the two agree,
 * which is why five wrong pairs on a real repository were invisible to every
 * fixture in this directory. This reads the pairs back and asks the one question
 * the snapshots cannot: does the file it names have that line at all?
 *
 * It lives in the core because the core owns what a position means, and it reads
 * the fixtures because a rule about the whole graph is only worth having over
 * every graph the repository produces.
 */
const FIXTURES = fileURLToPath(new URL('../../../fixtures', import.meta.url));

/**
 * Every graph a fixture holds: the snapshot, and the run beside it when there
 * has been one.
 *
 * Both, because either alone leaves a way through. A run nobody snapshotted is
 * not read at all if only the snapshots are; and a snapshot is only as current as
 * the last time somebody accepted one, so a wrong pair produced today would wait
 * for that. Between them and the snapshot gate there is no order of events in
 * which a bad pair reaches a release: if the run and the snapshot agree this
 * reads it twice, and if they disagree the snapshot gate says so.
 */
const GRAPHS = [
  'expected.graph.json',
  'expected.project-graph.json',
  '.flowatlas/graph.json',
  '.flowatlas/project-graph.json',
];

/** Which directory each service's paths are measured from. */
const serviceDirs = (fixture: string): Map<string, string> => {
  const config = join(FIXTURES, fixture, 'flowatlas.config.json');
  if (!existsSync(config)) return new Map([['', join(FIXTURES, fixture)]]);
  const read = JSON.parse(readFileSync(config, 'utf8')) as {
    services?: { name: string; repo?: string }[];
  };
  // A service the configuration only describes has no directory of its own, and
  // nothing it contributes carries a path into a file anybody can open.
  return new Map(
    (read.services ?? [])
      .filter((service) => typeof service.repo === 'string')
      .map((service) => [service.name, join(FIXTURES, fixture, service.repo as string)]),
  );
};

const lineCounts = new Map<string, number>();

const linesIn = (path: string): number | undefined => {
  const cached = lineCounts.get(path);
  if (cached !== undefined) return cached;
  if (!existsSync(path)) return undefined;
  const count = readFileSync(path, 'utf8').split('\n').length;
  lineCounts.set(path, count);
  return count;
};

interface Placed {
  where: string;
  file?: string;
  line?: number;
  repo?: string;
}

/** Every pair a snapshot records, with enough of its context to resolve it. */
const pairsIn = (fixture: string, snapshot: string): Placed[] => {
  const path = join(FIXTURES, fixture, snapshot);
  if (!existsSync(path)) return [];
  const graph = JSON.parse(readFileSync(path, 'utf8')) as {
    nodes?: {
      id: string;
      repo?: string;
      file?: string;
      line?: number;
      meta?: Record<string, unknown>;
    }[];
    edges?: { from: string; to: string; type: string; file?: string; line?: number }[];
  };
  const placed: Placed[] = [];
  for (const node of graph.nodes ?? []) {
    placed.push({ where: `${fixture}/${snapshot} node ${node.id}`, ...node });
    // The other position, for a node that says it was reached through one file
    // and written in another. Both have to be positions that exist: the whole
    // point of keeping the two facts apart is that each of them is then true,
    // and a declaration recorded out of range would be the same defect wearing
    // the other key's name.
    if (node.meta?.[DECLARED_IN] === undefined) continue;
    const declared = declaredAt(node);
    if (declared === undefined) continue;
    placed.push({
      where: `${fixture}/${snapshot} node ${node.id} declaration`,
      ...(node.repo === undefined ? {} : { repo: node.repo }),
      ...declared,
    });
  }
  for (const edge of graph.edges ?? []) {
    // An edge names the site that produced it, and the repo of that site is the
    // one the `from` end belongs to. A shared node — a channel, a third party —
    // carries no repo of its own, and an edge out of one is left alone rather
    // than measured from a directory that was guessed.
    const owner = (graph.nodes ?? []).find((node) => node.id === edge.from);
    placed.push({
      where: `${fixture}/${snapshot} edge ${edge.type} ${edge.from} -> ${edge.to}`,
      ...(owner?.repo === undefined ? {} : { repo: owner.repo }),
      ...(edge.file === undefined ? {} : { file: edge.file }),
      ...(edge.line === undefined ? {} : { line: edge.line }),
    });
  }
  return placed;
};

describe('every pair a fixture snapshot records is a position that exists', () => {
  const fixtures = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => entry.name);

  it('reads at least one snapshot, so that a silent zero cannot pass', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(fixture, () => {
      const dirs = serviceDirs(fixture);
      const wrong: string[] = [];
      for (const snapshot of GRAPHS) {
        for (const placed of pairsIn(fixture, snapshot)) {
          if (placed.file === undefined || placed.line === undefined) continue;
          const base = dirs.get(placed.repo ?? '') ?? dirs.get('');
          if (base === undefined) continue;
          const lines = linesIn(join(base, placed.file));
          // A path no file answers to is not this rule's business: a class an
          // installed package declares is recorded under the package's name,
          // which is a name rather than a path.
          if (lines === undefined) continue;
          if (placed.line >= 1 && placed.line <= lines) continue;
          wrong.push(`${placed.where}: ${placed.file}:${placed.line}, which has ${lines} lines`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});
