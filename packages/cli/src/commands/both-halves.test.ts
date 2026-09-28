import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { GraphNode, ProjectGraph } from '@flowatlas/core';
import type { LinkReport } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';
import { linkRepos } from './link.js';
import { runExtract } from './extract.js';

/**
 * One directory that is both halves, read the way somebody would actually read
 * it: `link` to write the configuration and `build` to read what it says.
 *
 * Asserted end to end rather than on `guessType` alone, because R88 was not a
 * wrong word in a file - it was a wrong word in a file that nothing downstream
 * questioned. A wiki app typed `react` by `link` produced 3,391 nodes, no channel
 * and no route, and every gate was happy: the graph was not empty, the reader
 * did not fail, and the only thing wrong with it was everything it did not
 * contain. So the assertions here are on the routes and on the requests that
 * reach them, which is the pair that cannot both be there unless one reader
 * opened both halves.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'koa-react-full-stack');
const FIXED = '2026-01-01T00:00:00.000Z';

// Beside the fixtures, so the copy still resolves the packages hoisted there.
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-both-halves-'));
const repo = join(scratch, 'koa-react-full-stack');
const configPath = join(scratch, 'flowatlas.config.json');

let project: ProjectGraph;
let report: LinkReport;
let chosen: string | undefined;

beforeAll(async () => {
  cpSync(FIXTURE, repo, {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas'),
  });
  const linked = linkRepos([repo], { config: configPath, mcp: false, print: () => undefined });
  chosen = linked.config.services[0]?.type;
  const built = await buildProject({ config: configPath, builtAt: FIXED });
  project = built.project;
  report = built.report;
}, 180_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const ofType = (type: string): GraphNode[] => project.nodes.filter((node) => node.type === type);

const goesTo = (from: string, type: string): string[] =>
  project.edges.filter((row) => row.from === from && row.type === type).map((row) => row.to);

describe('a repository that is a server and a browser in one directory', () => {
  it('is offered the type whose reader reads both halves', () => {
    expect(chosen).toBe('koa');
  });

  it('is read by that one reader', () => {
    expect(project.services[0]?.extractor).toBe('@flowatlas/extractor-nestjs');
  });

  it('has its routes read', () => {
    expect(
      ofType('entry')
        .map((node) => node.id)
        .sort(),
    ).toEqual([
      'entry:koa-react-full-stack:http:GET:/api/orders',
      'entry:koa-react-full-stack:http:POST:/api/orders',
    ]);
  });

  it('has its screen read, by the same reading', () => {
    expect(ofType('ui_component').map((node) => node.label)).toEqual(['OrdersScreen']);
    expect(ofType('ui_api_call')).toHaveLength(2);
  });

  /**
   * The assertion that says which reader ran, rather than which one the report
   * claims: both readers ask the entry adapters, so a route is not evidence. The
   * data layer is a pass the server reader has and the browser reader has not, so
   * a table here can only have been read by the reader that reads both halves.
   */
  it('has the layer under its routes read, which only one reader reaches', () => {
    expect(ofType('db_query').length).toBeGreaterThan(0);
    expect(ofType('table').map((node) => node.label)).toEqual(['orders']);
  });

  // The join is the point. Either half alone produces one end of it and no row
  // saying the other end is missing, which is how a graph half this size looked
  // like a graph.
  it('joins every request the browser half makes to the route the server half serves', () => {
    for (const call of ofType('ui_api_call')) {
      expect(goesTo(call.id, 'hits')).toEqual([
        `entry:koa-react-full-stack:http:${call.meta?.['method'] as string}:/api/orders`,
      ]);
    }
    expect(report.ui).toMatchObject({ total: 2, resolved: 2, unresolved: 0 });
  });
});

describe('the same directory with nothing written about it', () => {
  /**
   * `extract` has no `type` to look up, so it asks the entry adapters instead.
   * It must reach the same answer as the word `link` wrote, or the two commands
   * disagree about what the directory is.
   */
  it('is read by the same reader, from the other side of the rule', async () => {
    const { graph } = await runExtract(repo, { out: join(scratch, 'out'), types: false });
    expect(graph.nodes.filter((node) => node.type === 'entry')).toHaveLength(2);
    expect(graph.nodes.filter((node) => node.type === 'ui_component')).toHaveLength(1);
  }, 180_000);
});
