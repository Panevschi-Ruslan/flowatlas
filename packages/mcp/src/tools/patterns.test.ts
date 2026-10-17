import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import type { PatternTester, PatternTesterInput } from './common.js';

const connect = async (patternTester?: PatternTester): Promise<Client> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ dbPath: '/nowhere/graph.db', ...(patternTester === undefined ? {} : { patternTester }) });
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
};

const ask = async (client: Client, args: Record<string, unknown>): Promise<{ isError?: boolean; body: any }> => {
  const response = (await client.callTool({ name: 'test_pattern', arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
  return { ...(response.isError === undefined ? {} : { isError: response.isError }), body: JSON.parse(response.content[0]!.text) };
};

describe('test_pattern', () => {
  it('hands the YAML and the code to the tester, and answers its rules with what to do next', async () => {
    const asked: PatternTesterInput[] = [];
    const client = await connect(async (input) => {
      asked.push(input);
      return {
        rules: [{ id: 'bus', kind: 'publish', tests: [], code: { drew: ['producer on channel:book.added'], rows: [], holes: { $T: "'book.added'" } } }],
      };
    });
    const { body } = await ask(client, { yaml: '- id: bus', code: "bus.emit({ topic: 'book.added' })" });
    expect(asked).toEqual([{ yaml: '- id: bus', code: "bus.emit({ topic: 'book.added' })" }]);
    expect(body.rules[0].code.drew).toEqual(['producer on channel:book.added']);
    expect(body.next[0]).toMatch(/flowatlas patterns test/);
    await client.close();
  });

  it('names the part to fix when a rule is refused', async () => {
    const client = await connect(async () => ({ rules: [{ id: 'bus', refused: { part: 'channel', reason: 'a publish names its channel' }, tests: [] }] }));
    const { body } = await ask(client, { yaml: '- id: bus' });
    expect(body.next).toEqual(['fix channel of bus, then test_pattern again']);
    await client.close();
  });

  it('is bounded: ten rules, ten tests a rule', async () => {
    const test = { code: 'x()', pass: true, failures: [], drew: [], rows: [] };
    const client = await connect(async () => ({
      rules: Array.from({ length: 12 }, (_, index) => ({ id: `r${index}`, tests: Array.from({ length: 14 }, () => test) })),
    }));
    const { body } = await ask(client, { yaml: '- id: many' });
    expect(body.rules).toHaveLength(10);
    expect(body.rules[0].tests).toHaveLength(10);
    expect(body.truncated).toBe(2);
    await client.close();
  });

  it('says why it cannot answer without the readers, and passes a YAML problem on', async () => {
    const bare = await connect();
    expect((await ask(bare, { yaml: '- id: x' })).isError).toBe(true);
    await bare.close();
    const broken = await connect(async () => ({ rules: [], error: 'the YAML is not read: it is not a list of rules' }));
    const { isError, body } = await ask(broken, { yaml: 'x' });
    expect(isError).toBe(true);
    expect(body.error).toMatch(/not a list/);
    await broken.close();
  });
});
