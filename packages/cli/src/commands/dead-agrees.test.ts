import { copyFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowatlasServer } from '@flowatlas/mcp';
import { describe, expect, it } from 'vitest';
import { runDead } from './dead.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

/**
 * One analysis (P95, D1): `flowatlas dead` and the MCP server's `dead` read
 * the same linker functions, so on every fixture they list the same rows with
 * the same verdicts, and `dead({id})` on each row says what the list says.
 */
const FIXTURES = ['multi-repo', 'multi-repo-doctor', 'multi-repo-dead-routes'];

const ask = async (config: string, calls: Array<Record<string, unknown>>, dbPath?: string): Promise<any[]> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: config, ...(dbPath === undefined ? {} : { dbPath }) });
  await server.connect(serverSide);
  const client = new Client({ name: 'dead-agrees', version: '0' });
  await client.connect(clientSide);
  try {
    const answers = [];
    for (const args of calls) {
      const response = (await client.callTool({ name: 'dead', arguments: args })) as { content: Array<{ text: string }> };
      answers.push(JSON.parse(response.content[0]!.text));
    }
    return answers;
  } finally {
    await client.close();
  }
};

const agree = async (config: string, db?: string): Promise<void> => {
  const { result } = await runDead({ config, kind: 'all', max: '100000', ...(db === undefined ? {} : { db }) });
  const command = [
    ...(result.entries ?? []).map((row) => `${row.id} ${row.verdict}`),
    ...(result.channels ?? []).map((row) => `${row.id} ${row.verdict}`),
    ...(result.providers ?? []).map((row) => `${row.id} ${row.verdict}`),
  ].sort();
  const [listed] = await ask(config, [{ maxNodes: 2000 }], db);
  expect((listed.rows as Array<{ id: string; verdict: string }>).map((row) => `${row.id} ${row.verdict}`).sort()).toEqual(command);
  const ids = command.map((line) => line.slice(0, line.lastIndexOf(' ')));
  const one = await ask(config, ids.map((id) => ({ id })), db);
  expect(one.map((answer, at) => `${ids[at]} ${answer.verdict}`).sort()).toEqual(command);
};

describe('flowatlas dead and the MCP dead tool agree', () => {
  it('beside an observed file too, where traffic is evidence for each verdict (P110)', async () => {
    const fixture = join(ROOT, 'fixtures', 'multi-repo');
    const copy = mkdtempSync(join(tmpdir(), 'flowatlas-dead-agrees-'));
    try {
      cpSync(join(fixture, '.flowatlas'), copy, { recursive: true });
      copyFileSync(join(fixture, 'expected.cli', 'observe.json'), join(copy, 'observed.json'));
      await agree(join(fixture, 'flowatlas.config.json'), join(copy, 'graph.db'));
      const { result } = await runDead({ config: join(fixture, 'flowatlas.config.json'), db: join(copy, 'graph.db'), kind: 'entries' });
      expect(result.entries?.some((row) => row.verdict === 'alive' && row.evidence?.seen !== undefined)).toBe(true);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  for (const fixture of FIXTURES) {
    it(`on ${fixture}`, async () => {
      const config = join(ROOT, 'fixtures', fixture, 'flowatlas.config.json');
      const { result } = await runDead({ config, kind: 'all', max: '100000' });
      const command = [
        ...(result.entries ?? []).map((row) => `${row.id} ${row.verdict}`),
        ...(result.channels ?? []).map((row) => `${row.id} ${row.verdict}`),
        ...(result.providers ?? []).map((row) => `${row.id} ${row.verdict}`),
      ].sort();

      const [listed] = await ask(config, [{ maxNodes: 2000 }]);
      const tool = (listed.rows as Array<{ id: string; verdict: string }>).map((row) => `${row.id} ${row.verdict}`).sort();
      expect(tool).toEqual(command);
      expect(command.length).toBeGreaterThan(0);

      // Each row asked about on its own says what the list says.
      const ids = command.map((line) => line.slice(0, line.lastIndexOf(' ')));
      const one = await ask(config, ids.map((id) => ({ id })));
      expect(one.map((answer, at) => `${ids[at]} ${answer.verdict}`).sort()).toEqual(command);
    });
  }
});
