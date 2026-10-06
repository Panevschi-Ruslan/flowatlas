import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { GraphNode, ProjectGraph, RepoGraph } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanCandidates } from './init.js';
import { buildProject } from './build.js';
import { runExtract } from './extract.js';
import { runFlow } from './flow.js';

/**
 * What P21 promises about functions and routes declared in Terraform, read off
 * the three fixtures' own source by hand rather than off a recording (R09).
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const NEUTRAL = join(ROOT, 'scripts', 'fixture.config.json');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-lambda-'));

const copyOf = (name: string, as = name): string => {
  const dir = join(scratch, as);
  cpSync(join(ROOT, 'fixtures', name), dir, { recursive: true, filter: (from) => !from.split(sep).includes('.flowatlas') });
  return dir;
};

let rest: RepoGraph;
let modules: ProjectGraph;
let multi: ProjectGraph;
let multiConfig: string;
let wrapped: RepoGraph;
let namespaced: ProjectGraph;
let namespacedConfig: string;

beforeAll(async () => {
  rest = (await runExtract(copyOf('lambda-terraform-rest'), { config: NEUTRAL, cache: false })).graph;
  wrapped = (await runExtract(copyOf('lambda-wrapped-handlers'), { config: NEUTRAL, cache: false })).graph;
  modules = (await buildProject({ config: join(copyOf('lambda-terraform-modules'), 'flowatlas.config.json'), builtAt: FIXED })).project;
  multiConfig = join(copyOf('multi-repo-lambda'), 'flowatlas.config.json');
  multi = (await buildProject({ config: multiConfig, builtAt: FIXED })).project;
  namespacedConfig = join(copyOf('lambda-namespace-handlers'), 'flowatlas.config.json');
  namespaced = (await buildProject({ config: namespacedConfig, builtAt: FIXED })).project;
}, 240_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

type Graph = Pick<RepoGraph, 'nodes' | 'edges' | 'unresolved'>;

const entry = (graph: Graph, id: string): GraphNode => {
  const found = graph.nodes.find((node) => node.id === id);
  if (found === undefined) throw new Error(`no ${id}; entries are ${graph.nodes.filter((node) => node.type === 'entry').map((node) => node.id).join(', ')}`);
  return found;
};

const handled = (graph: Graph, from: string): string[] =>
  graph.edges.filter((edge) => edge.from === from && edge.type === 'handles').map((edge) => edge.to);

const chain = (graph: Graph, from: string): string[] =>
  graph.edges
    .filter((edge) => edge.from === from && edge.type === 'guarded_by')
    .sort((a, b) => Number(a.meta?.['order']) - Number(b.meta?.['order']))
    .map((edge) => graph.nodes.find((node) => node.id === edge.to)?.label ?? edge.to);

describe('a function is an invoke entry onto the handler it names', () => {
  const r = (key: string): string => `entry:lending-library-loans:invoke:${key}`;

  it('through a middleware chain, landing on the function the chain wraps', () => {
    expect(handled(rest, r('library-dev-create-loan'))).toEqual(['lending-library-loans#src/loans/create-loan.ts:createLoan']);
    expect(chain(rest, r('library-dev-create-loan'))).toEqual(['jsonBodyParser()', 'httpErrorHandler()']);
  });

  it('through a chain whose function is written in it', () => {
    const [target] = handled(rest, r('library-dev-renew-loan'));
    expect(target).toMatch(/^lending-library-loans#src\/loans\/renew-loan\.ts:handler@\d+$/);
  });

  it('through a handler packaged from dist/, mapped back to its source by the tsconfig', () => {
    expect(handled(rest, r('library-dev-record-return'))).toEqual(['lending-library-loans#src/returns/record-return.ts:handler']);
    expect(entry(rest, r('library-dev-record-return')).meta).toMatchObject({ packagedFrom: 'dist/returns', sourceDirectory: 'src/returns' });
  });

  it('a plain exported function, and on into its body', () => {
    expect(handled(rest, r('library-dev-get-loan'))).toEqual(['lending-library-loans#src/loans/get-loan.ts:handler']);
    expect(rest.edges).toContainEqual(
      expect.objectContaining({ from: 'lending-library-loans#src/loans/get-loan.ts:handler', to: 'lending-library-loans#src/lib/loans-table.ts:findLoan', type: 'calls' }),
    );
  });

  it('every function of the module fixture lands on its handler, whichever module declared it', () => {
    for (const name of ['catalogue-get-title', 'catalogue-search-titles', 'catalogue-register-borrower', 'catalogue-get-borrower']) {
      expect(handled(modules, `entry:catalogue:invoke:${name}`), name).toHaveLength(1);
    }
    expect(handled(modules, 'entry:catalogue:invoke:catalogue-register-borrower')).toEqual(['catalogue#src/handlers/register-borrower.ts:register']);
  });

  it('a function per directory, each with its own manifest, is read as one program', () => {
    expect(handled(multi, 'entry:loans:invoke:library-dev-create-loan')).toEqual(['loans#functions/create-loan/index.ts:createLoan']);
    expect(multi.edges).toContainEqual(
      expect.objectContaining({ from: 'loans#functions/create-loan/index.ts:createLoan', to: 'loans#shared/loans-table.ts:saveLoan' }),
    );
  });
});

describe('a route is an http entry onto the same handler', () => {
  it('with the full path of a resource tree two levels deep', () => {
    const route = 'entry:lending-library-loans:http:POST:/loans/:param/renewal';
    expect(entry(rest, route).meta).toMatchObject({ rawPath: '/loans/{loanId}/renewal', function: 'library-dev-renew-loan' });
    expect(handled(rest, route)).toEqual(handled(rest, 'entry:lending-library-loans:invoke:library-dev-renew-loan'));
    expect(chain(rest, route)).toEqual(['AWS_IAM', 'httpErrorHandler()']);
  });

  it('through the public HTTP API module and through a described module', () => {
    expect(modules.nodes.filter((node) => node.kind === 'http').map((node) => node.id).sort()).toEqual([
      'entry:catalogue:http:GET:/borrowers/:param',
      'entry:catalogue:http:GET:/titles',
      'entry:catalogue:http:GET:/titles/:param',
      'entry:catalogue:http:POST:/borrowers',
    ]);
    expect(handled(modules, 'entry:catalogue:http:GET:/borrowers/:param')).toEqual(['catalogue#src/handlers/get-borrower.ts:handler']);
  });

  it('built across the repository that owns the API root, by its output and by its parameter', () => {
    expect(multi.nodes.filter((node) => node.kind === 'http').map((node) => node.id).sort()).toEqual([
      'entry:holds:http:DELETE:/v1/holds/:param',
      'entry:holds:http:POST:/v1/holds',
      'entry:loans:http:GET:/v1/loans/:param',
      'entry:loans:http:POST:/v1/loans',
      'entry:platform:http:GET:/v1/borrowers/:param/loans',
    ]);
    expect(entry(multi, 'entry:loans:http:POST:/v1/loans').meta).toMatchObject({ rootedIn: 'platform' });
  });

  it('a route the owner wires to a function another repository deploys, by its name', () => {
    expect(handled(multi, 'entry:platform:http:GET:/v1/borrowers/:param/loans')).toEqual([
      'loans#functions/list-borrower-loans/index.ts:handler',
    ]);
  });

  it("flow 'POST /v1/loans' walks from the route into the handler body", () => {
    let out = '';
    runFlow('POST /v1/loans', { config: multiConfig, format: 'json' }, { out: (text) => void (out += text), err: () => undefined });
    const ids = JSON.stringify(JSON.parse(out));
    expect(ids).toContain('loans#functions/create-loan/index.ts:createLoan');
    expect(ids).toContain('loans#shared/loans-table.ts:saveLoan');
  });
});

describe('what cannot be named is one row naming what to set, and no join', () => {
  it('a function repeated over something unknown', () => {
    const rows = rest.unresolved.filter((row) => row.reason === 'function-repeated-unread');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hint).toContain('var.reminder_channels');
    const unnamed = rest.nodes.filter((node) => node.kind === 'invoke' && node.meta?.['nameRead'] === false);
    expect(unnamed.map((node) => node.id)).toEqual(['entry:lending-library-loans:invoke:${…}@aws_lambda_function.send_reminder[?]']);
  });

  it('a name that depends on a disputed variable', () => {
    const rows = multi.unresolved.filter((row) => row.reason === 'function-name-disputed');
    expect(rows.map((row) => row.service)).toEqual(['holds', 'holds']);
    expect(rows[0]?.hint).toContain('services[].infra.vars');
    expect(multi.nodes.filter((node) => node.repo === 'holds' && node.kind === 'invoke').every((node) => node.meta?.['name'] === undefined)).toBe(true);
  });

  it('a remote module with no description', () => {
    const rows = modules.unresolved.filter((row) => row.reason === 'infra-module-undescribed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hint).toContain('adapters.infra.modules');
    expect(modules.nodes.some((node) => String(node.meta?.['declaredAs'] ?? '').includes('newsletter'))).toBe(false);
  });
});

describe('a handler wrapped with the function second (R167)', () => {
  const d = (key: string): string => `entry:lending-library-desk:invoke:library-desk-${key}`;
  const edge = (from: string) => wrapped.edges.find((each) => each.from === from && each.type === 'handles');

  it('a name, then the function: through a const under a chain, and inline inside one', () => {
    expect(edge(d('create-loan'))).toMatchObject({ confidence: 'static' });
    expect(edge(d('create-loan'))?.to).toMatch(/^lending-library-desk#src\/handlers\/create-loan\.ts:handler@\d+$/);
    expect(chain(wrapped, d('create-loan'))).toEqual(['jsonBodyParser()', 'traced']);
    expect(edge(d('renew-loan'))).toMatchObject({ to: 'lending-library-desk#src/handlers/renew-loan.ts:renewLoan', confidence: 'static' });
    expect(chain(wrapped, d('renew-loan'))).toEqual(['jsonBodyParser()', 'traced']);
  });

  it('options, then the function, and the function, then options', () => {
    expect(edge(d('record-return'))).toMatchObject({ to: 'lending-library-desk#src/handlers/record-return.ts:recordReturn', confidence: 'static' });
    expect(edge(d('place-hold'))).toMatchObject({ to: 'lending-library-desk#src/handlers/place-hold.ts:placeHold' });
  });

  it('static where the wrapper was read, heuristic where its package is not installed, and says which', () => {
    expect(edge(d('cancel-hold'))).toMatchObject({ to: 'lending-library-desk#src/handlers/cancel-hold.ts:cancelHold', confidence: 'static' });
    expect(edge(d('place-hold'))?.confidence).toBe('heuristic');
    expect(entry(wrapped, d('place-hold')).meta?.['wrapperUnread']).toContain('@lending/telemetry, which is not installed');
    // A wrapper of this repository that hands the function to that package is no surer.
    expect(edge(d('send-reminders'))).toMatchObject({ to: 'lending-library-desk#src/handlers/send-reminder.ts:sendReminders', confidence: 'heuristic' });
    expect(entry(wrapped, d('send-reminders')).meta?.['wrapperUnread']).toMatch(/^measured hands it on, and instrument comes from/);
  });

  it('a call handed two functions is still a row, naming the call', () => {
    expect(edge(d('list-overdue'))).toBeUndefined();
    const rows = wrapped.unresolved.filter((row) => row.reason === 'function-handler-unread');
    expect(rows.map((row) => row.message)).toEqual([expect.stringContaining('firstOf(fromCache, fromTable), which is handed 2 functions')]);
  });
});

describe('a handler re-exported through a namespace or `export … from` (R168)', () => {
  const d = (key: string): string => `entry:desk:invoke:library-desk-${key}`;
  const edge = (from: string) => namespaced.edges.find((each) => each.from === from && each.type === 'handles');

  it('`export const x = ns.x` and `= ns[\'x\']` land on the function the namespace exports', () => {
    expect(edge(d('create-loan'))).toMatchObject({ to: 'desk#src/operations/loans.ts:createLoan', confidence: 'static' });
    expect(edge(d('renew-loan'))).toMatchObject({ to: 'desk#src/operations/loans.ts:renewLoan', confidence: 'static' });
  });

  it('`export { x } from`, under its own name and under another', () => {
    expect(edge(d('place-hold'))).toMatchObject({ to: 'desk#src/operations/holds.ts:placeHold', confidence: 'static' });
    expect(edge(d('cancel-hold'))).toMatchObject({ to: 'desk#src/operations/holds.ts:withdrawHold', confidence: 'static' });
  });

  it('`export *`, directly and behind a namespace import of a module that re-exports', () => {
    expect(edge(d('record-return'))).toMatchObject({ to: 'desk#src/operations/returns.ts:recordReturn', confidence: 'static' });
    expect(edge(d('process-returns'))).toMatchObject({ to: 'desk#src/operations/returns.ts:processReturns', confidence: 'static' });
  });

  it('a re-export of what a package builds is still a row, about the entry and naming where the call is', () => {
    expect(edge(d('archive-loan'))).toBeUndefined();
    const rows = namespaced.unresolved.filter((row) => row.reason === 'function-handler-unread');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: d('archive-loan'), file: 'infra/functions.tf' });
    expect(rows[0]?.message).toContain('src/operations/archive.ts builds that export with batchHandler(');
  });

  it("flow from a route through a queue to that function counts the function's row", () => {
    const counted = (route: string): unknown => {
      let out = '';
      runFlow(route, { config: namespacedConfig, format: 'json' }, { out: (text) => void (out += text), err: () => undefined });
      return (JSON.parse(out) as { unresolvedOnPath: unknown }).unresolvedOnPath;
    };
    expect(counted('POST /loans')).toBe(1);
    expect(counted('POST /returns')).toBe(0);
  });
});

describe('a handler found by searching, when nothing says how the package is built', () => {
  it('is joined, and the edge says it was not proven', async () => {
    const dir = copyOf('lambda-terraform-rest', 'lambda-terraform-rest-zipped');
    const tf = join(dir, 'infra', 'functions.tf');
    // The package is a zip a script builds: nothing names what is in it.
    writeFileSync(tf, readFileSync(tf, 'utf8').replace(/filename\s+= data\.archive_file\.loans\.output_path/g, 'filename = "${path.module}/build/loans.zip"'));
    const graph = (await runExtract(dir, { config: NEUTRAL, cache: false })).graph;
    const edge = graph.edges.find((each) => each.from === 'entry:lending-library-loans:invoke:library-dev-get-loan' && each.type === 'handles');
    expect(edge).toMatchObject({ to: 'lending-library-loans#src/loans/get-loan.ts:handler', confidence: 'heuristic' });
  });
});

describe('the build cache', () => {
  it('reads a repository again when only its Terraform changed', async () => {
    const dir = copyOf('lambda-terraform-modules', 'lambda-terraform-modules-cached');
    const config = join(dir, 'flowatlas.config.json');
    await buildProject({ config, builtAt: FIXED });
    const tf = join(dir, 'infra', 'main.tf');
    writeFileSync(tf, readFileSync(tf, 'utf8').replace('"catalogue-get-title"', '"catalogue-find-title"'));
    const again = (await buildProject({ config, builtAt: FIXED })).project;
    expect(again.nodes.map((node) => node.id)).toContain('entry:catalogue:invoke:catalogue-find-title');
    expect(again.nodes.map((node) => node.id)).not.toContain('entry:catalogue:invoke:catalogue-get-title');
  }, 120_000);
});

describe('init', () => {
  it('proposes lambda for every repository of the fixtures, the one with no manifest included', () => {
    const multiDir = join(ROOT, 'fixtures', 'multi-repo-lambda');
    expect(scanCandidates(multiDir, scratch).map((candidate) => [candidate.name, candidate.type])).toEqual([
      ['lending-library-holds', 'lambda'],
      ['loans', 'lambda'],
      ['platform', 'lambda'],
    ]);
    const single = scanCandidates(join(ROOT, 'fixtures'), scratch).filter((candidate) => candidate.repo.includes('lambda-terraform'));
    expect(single.map((candidate) => candidate.type)).toEqual(['lambda', 'lambda']);
  });
});
