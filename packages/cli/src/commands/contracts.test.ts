import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  checkContracts,
  parseContractReport,
  type ContractFinding,
  type ContractReport,
} from '@flowatlas/contracts';
import type { ProjectGraph } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';
import { runContracts } from './contracts.js';
import { contractsHook } from './mcp.js';
import { CliError, EXIT } from '../exit.js';
import type { QueryIo } from '../query/answer.js';
import { writeTestDb } from '../analysis/__fixtures__/test-db.js';

/**
 * What the tool ought to say about `fixtures/multi-repo-contracts`, read off
 * that fixture's own source.
 *
 * Not compared against a recording. A recording proves the behaviour has not
 * moved; it cannot tell a right answer from a wrong one, and where it was taken
 * while the answer was wrong it keeps the mistake and calls the correction a
 * regression (R09). Every expectation below is a claim about two declarations
 * in two repositories, written so that a failure names the claim.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';

// Beside the fixtures, so the copy still resolves the packages hoisted there.
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-contracts-'));
const config = join(scratch, 'multi-repo-contracts', 'flowatlas.config.json');

let graph: ProjectGraph;
let report: ContractReport;

beforeAll(async () => {
  // A build writes each repository's graph beside its source, so two test files
  // building one fixture at once are two builds writing to one place. Reading a
  // copy is also what makes this the build these assertions asked for rather
  // than whichever build happened to run last.
  cpSync(join(ROOT, 'fixtures', 'multi-repo-contracts'), join(scratch, 'multi-repo-contracts'), {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas'),
  });
  const built = await buildProject({ config, builtAt: FIXED });
  graph = built.project;
  report = checkContracts(graph, { generatedAt: FIXED });
}, 240_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** Everything said about one pair of declarations, however many edges carry it. */
const about = (sender: string, receiver: string): ContractFinding[] =>
  report.findings.filter(
    (finding) => finding.sender.typeId === sender && finding.receiver.typeId === receiver,
  );

/** How one pair of declarations came out, as a word. */
const statusOf = (sender: string, receiver: string): string =>
  report.edges.find(
    (row) => row.sender.typeId === sender && row.receiver.typeId === receiver,
  )?.status ?? `nothing: no edge sends ${sender} to ${receiver}`;

/** One finding per field, as `severity kind field`, so a list reads as prose. */
const facts = (findings: readonly ContractFinding[]): string[] =>
  [...new Set(findings.map((finding) => `${finding.severity} ${finding.kind} ${finding.field}`))].sort();

describe('what cannot drift', () => {
  it('calls a declaration both ends import from the shared package shared', () => {
    expect(statusOf('type:@fx/wire#MoneyDto', 'type:@fx/wire#MoneyDto')).toBe('shared');
  });

  it('calls two verbatim copies of one shape identical', () => {
    expect(statusOf('type:gateway#AddressDto', 'type:orders#AddressDto')).toBe('identical');
  });

  it('walks no field on either of them', () => {
    expect(about('type:@fx/wire#MoneyDto', 'type:@fx/wire#MoneyDto')).toEqual([]);
    expect(about('type:gateway#AddressDto', 'type:orders#AddressDto')).toEqual([]);
  });
});

describe('what has drifted, on a call between two services', () => {
  it('reports the four kinds of disagreement on the body of POST /orders', () => {
    expect(facts(about('type:gateway#CreateOrderDto', 'type:orders#CreateOrderDto'))).toEqual([
      'error missing_required channel',
      'info extra_field debugId',
      'warning optionality_mismatch note',
    ]);
  });

  it('reports the answer as well as the request', () => {
    expect(facts(about('type:orders#OrderDto', 'type:gateway#OrderDto'))).toEqual([
      'error type_mismatch total',
    ]);
  });

  it('names both services and the field, in one sentence', () => {
    const [finding] = about('type:gateway#CreateOrderDto', 'type:orders#CreateOrderDto');
    expect(finding?.message).toBe(
      'receiver orders requires `channel: string`; sender gateway does not send it',
    );
  });
});

describe('what has drifted, on a channel', () => {
  it('reports a payload nobody publishes a field of', () => {
    expect(facts(about('type:orders#OrderCreatedEvent', 'type:billing#OrderCreatedEvent'))).toEqual([
      'error missing_required customerId',
    ]);
  });

  it('reports the question an rpc caller asks with the wrong shape', () => {
    expect(facts(about('type:billing#GetOrderQuery', 'type:orders#GetOrderQuery'))).toEqual([
      'error missing_required includeItems',
      'info extra_field includeRefunds',
    ]);
  });

  it('keys a channel contract by the two ends and not by the channel between them', () => {
    const found = report.edges.find((row) => row.direction === 'payload' && row.sender.service === 'orders');
    expect(found?.edgeKey).toMatch(/^producer:orders#.*\|emits\|consumer:billing#/);
  });
});

describe('what has drifted, from a browser', () => {
  it('reports a request from a browser exactly as it reports one from a service', () => {
    expect(facts(about('type:web#CreateOrderDto', 'type:orders#CreateOrderDto'))).toEqual([
      'error missing_required shipTo.postcode',
    ]);
  });

  it('reports the answer the browser expects back', () => {
    expect(facts(about('type:orders#OrderDto', 'type:web#OrderDto'))).toEqual([
      'error type_mismatch total',
    ]);
  });
});

describe('the rules of the wire', () => {
  const wire = (): ContractFinding[] =>
    report.findings.filter((finding) => finding.receiver.typeId === 'type:orders#WireDto');

  it('finds no error at all on the pair that exercises every one of them', () => {
    expect(wire().filter((finding) => finding.severity === 'error')).toEqual([]);
  });

  it('applies every rule the plan names, and says where', () => {
    const row = report.edges.find((edge) => edge.receiver.typeId === 'type:orders#WireDto');
    expect(row?.rulesApplied).toEqual([
      'any-unknown-skip:extras',
      'bigint-string:reference',
      'buffer-string:signature',
      'class-transformer:customerId',
      'class-transformer:internalNote',
      'class-transformer:secret',
      'class-transformer:shippingCity',
      'class-transformer:transform:coupon',
      'class-transformer:transform:score',
      'date-string:placedAt',
      'set-map-json:counts',
      'set-map-json:tags',
    ]);
  });

  it('warns once about each collection JSON cannot carry, and never worse', () => {
    const collections = wire().filter((finding) => finding.rule === 'set-map-json');
    expect(collections.map((finding) => `${finding.severity} ${finding.field}`).sort()).toEqual([
      'warning counts',
      'warning tags',
    ]);
  });

  it('still reports the three breaks the rules must not hide', () => {
    expect(facts(about('type:gateway#WireBrokenDto', 'type:orders#WireBrokenDto'))).toEqual([
      'error missing_required reference',
      'error type_mismatch delivery',
      'error type_mismatch placedAt',
    ]);
  });

  it('names the value the receiver has never heard of', () => {
    const [finding] = about('type:gateway#WireBrokenDto', 'type:orders#WireBrokenDto').filter(
      (row) => row.field === 'delivery',
    );
    expect(finding?.message).toContain("'courier' is not among the values the receiver accepts");
  });
});

describe('a shape too deep and a shape that contains itself', () => {
  it('names the difference above the cut and reports the one below it by depth', () => {
    expect(facts(about('type:gateway#DeepDto', 'type:orders#DeepDto'))).toEqual([
      'error type_mismatch label',
      'error type_mismatch next.next.next',
    ]);
  });

  it('records where it stopped rather than going quiet about it', () => {
    const row = report.edges.find((edge) => edge.receiver.typeId === 'type:orders#DeepDto');
    expect(row?.rulesApplied).toContain('depth-cap:next.next.next');
  });

  it('names the field itself when asked to look deeper', () => {
    const deeper = checkContracts(graph, { generatedAt: FIXED, depth: 6 });
    expect(
      deeper.findings
        .filter((finding) => finding.receiver.typeId === 'type:orders#DeepDto')
        .map((finding) => finding.field)
        .sort(),
    ).toEqual(['label', 'next.next.next.next.leaf']);
  });

  it('terminates on a shape that contains itself, and says what differs', () => {
    expect(facts(about('type:gateway#CategoryDto', 'type:orders#CategoryDto'))).toEqual([
      'error missing_required id',
      'info extra_field code',
    ]);
  });
});

describe('a difference somebody decided to live with', () => {
  it('keeps every finding on the annotated call and counts none of them', () => {
    const excused = report.ignored.filter((finding) =>
      finding.ignoredBy?.endsWith('OrdersClient.legacy'),
    );
    expect(facts(excused)).toEqual([
      'error missing_required channel',
      'error type_mismatch total',
      'info extra_field debugId',
      'warning optionality_mismatch note',
    ]);
    expect(report.findings.some((finding) => finding.ignored)).toBe(false);
  });
});

describe('nothing is quietly left out', () => {
  it('puts every boundary in exactly one of the two lists', () => {
    const directions = new Set([
      ...report.edges.map((row) => `${row.edgeKey} ${row.direction}`),
      ...report.unchecked.map((row) => `${row.edgeKey} ${row.direction}`),
    ]);
    expect(directions.size).toBe(report.edges.length + report.unchecked.length);
  });

  it('says why each of the rest could not be checked, and what to do about it', () => {
    for (const row of report.unchecked) {
      expect(row.message.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
    }
  });

  it('counts what it says', () => {
    const bySeverity = (level: string): number =>
      report.findings.filter((finding) => finding.severity === level).length;
    expect(report.summary.errors).toBe(bySeverity('error'));
    expect(report.summary.warnings).toBe(bySeverity('warning'));
    expect(report.summary.infos).toBe(bySeverity('info'));
    expect(report.summary.ignored).toBe(report.ignored.length);
  });
});

describe('what an agent is told', () => {
  it('answers check_contract with the field, not just with the hashes', async () => {
    // The whole of D6: the server can say two hashes differ on its own, and
    // which field differs only reaches an agent through the hook the command
    // hands it. Asked here the way an editor asks it, over a real transport.
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { createFlowatlasServer, DbHandle } = await import('@flowatlas/mcp');

    const handle = new DbHandle({ configPath: config });
    const server = createFlowatlasServer({
      configPath: config,
      contractChecker: contractsHook(() => {
        const opened = handle.open();
        return 'error' in opened ? undefined : opened.db;
      }),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);

    // The finding this asserts on, named rather than taken as whichever came
    // first: the order of the report is a presentation decision and this test
    // is about what an agent is told, not about where a row sits in a list.
    const drift = report.findings.find(
      (finding) =>
        finding.direction === 'request' &&
        finding.kind === 'missing_required' &&
        finding.field === 'channel',
    );
    const answer = (await client.callTool({
      name: 'check_contract',
      arguments: { from: drift?.edge.from, to: drift?.edge.to },
    })) as { content: Array<{ text: string }> };
    const body = JSON.parse(answer.content[0]?.text ?? '{}') as {
      status: string;
      findings: Array<{ kind: string; field: string }>;
    };

    expect(body.status).toBe('hash_differs');
    expect(body.findings.map((finding) => `${finding.kind} ${finding.field}`)).toContain(
      'missing_required channel',
    );
    await client.close();
    handle.close();
  });
});

/** A pair of streams a test can read back. */
const io = (): QueryIo & { text: () => string } => {
  let out = '';
  return { out: (text) => (out += text), err: () => undefined, tty: false, text: () => out };
};

describe('the command', () => {
  it('says the same thing reading the database as reading the graph', () => {
    // The command reads the database and everything above reads the graph the
    // build produced. Anything the database cannot carry — a union's members
    // were once such a thing — would show up as an answer that is right in one
    // place and quietly poorer in the other.
    const run = runContracts({ config, format: 'json' }, io());
    expect(run.report.findings.map((finding) => finding.message).sort()).toEqual(
      report.findings.map((finding) => finding.message).sort(),
    );
    expect(run.report.summary).toEqual(report.summary);
  });

  it('leaves the whole report on disk, whatever it printed', () => {
    const answer = io();
    const run = runContracts({ config, format: 'text', maxNodes: '1' }, answer);
    expect(run.file).toBeDefined();
    expect(existsSync(run.file as string)).toBe(true);
    const written = parseContractReport(JSON.parse(readFileSync(run.file as string, 'utf8')));
    expect(written.findings.length).toBe(report.findings.length);
    expect(answer.text()).toContain('more findings; the whole list is in');
  });

  it('writes the same bytes on two runs over one graph', () => {
    const first = runContracts({ config, format: 'json' }, io());
    const second = runContracts({ config, format: 'json' }, io());
    expect(readFileSync(second.file as string, 'utf8')).toBe(
      readFileSync(first.file as string, 'utf8').replace(
        first.report.generatedAt,
        second.report.generatedAt,
      ),
    );
  });

  it('answers 0 when nobody asked it to fail', () => {
    expect(runContracts({ config }, io()).exitCode).toBe(EXIT.ok);
  });

  it('answers 1 when something is at or above the level asked about', () => {
    expect(runContracts({ config, failOn: 'error' }, io()).exitCode).toBe(EXIT.failed);
    expect(runContracts({ config, failOn: 'warning' }, io()).exitCode).toBe(EXIT.failed);
  });

  it('answers 2 when there is no graph to read', () => {
    expect(() => runContracts({ db: join(scratch, 'nothing.db') }, io())).toThrow();
  });

  it('answers 2 when the graph holds no types, rather than "nothing is broken"', () => {
    const empty = writeTestDb({ nodes: [], edges: [] });
    expect(() => runContracts({ db: empty }, io())).toThrow(/0 types in the registry/);
  });

  it('says a project with no boundary has none, rather than printing an empty table', () => {
    const alone = writeTestDb({
      nodes: [],
      edges: [],
      types: {
        'type:orders#OrderDto': {
          name: 'OrderDto',
          kind: 'object',
          declaredIn: 'orders#src/dto.ts',
          structuralHash: 'aaa',
          fields: [{ name: 'id', type: 'string', optional: false }],
        },
      },
    });
    const answer = io();
    // `out` is named rather than left to the configuration. Without it the
    // command looks for one upward from the working directory, which in a test
    // is this checkout: it found the configuration a developer keeps at the
    // root, read the output directory of somebody's own project out of it, and
    // wrote `contracts.json` there. The report was committed once before anyone
    // noticed, and the test was not testing what it said either.
    const run = runContracts({ db: alone, out: join(scratch, 'no-boundary') }, answer);
    expect(run.exitCode).toBe(EXIT.ok);
    expect(answer.text()).toContain('no boundary between services in this graph');
  });

  it('shows only what is at or above the level asked for', () => {
    const answer = io();
    runContracts({ config, severity: 'error', format: 'json' }, answer);
    const shown = JSON.parse(answer.text()) as ContractReport;
    expect(shown.findings.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('narrows to one boundary when asked, and fails on that one alone', () => {
    const edge = report.findings.find((finding) => finding.direction === 'payload')?.edgeKey;
    const answer = io();
    const run = runContracts({ config, edge, format: 'json', failOn: 'error' }, answer);
    expect(run.shown.edges.every((row) => row.edgeKey === edge)).toBe(true);
    expect(run.exitCode).toBe(EXIT.failed);
  });

  it('narrows to one service, on either side of the boundary', () => {
    const run = runContracts({ config, service: 'billing', format: 'json' }, io());
    expect(
      run.shown.findings.every(
        (finding) => finding.sender.service === 'billing' || finding.receiver.service === 'billing',
      ),
    ).toBe(true);
    expect(run.shown.findings.length).toBeGreaterThan(0);
  });

  it('refuses a flag it does not understand rather than guessing', () => {
    expect(() => runContracts({ config, format: 'yaml' }, io())).toThrow(CliError);
    expect(() => runContracts({ config, severity: 'fatal' }, io())).toThrow(CliError);
  });

  it('draws the same report as a document', () => {
    const answer = io();
    runContracts({ config, format: 'markdown', severity: 'error' }, answer);
    expect(answer.text()).toContain('## Contracts');
    expect(answer.text()).toContain('| severity | kind | between | direction | field | what |');
  });
});
