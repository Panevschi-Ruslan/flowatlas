import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/** The documents of `fixtures/multi-repo` (P118), as an assistant asks for them. */
const CONFIG = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'multi-repo', 'flowatlas.config.json');

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath: CONFIG }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('get_spec (P118)', () => {
  it('writes a service\'s routes as the OpenAPI document `flowatlas spec` writes', async () => {
    const answer = await call('get_spec', { service: 'orders' });
    expect(answer).toMatchObject({ service: 'orders', kind: 'openapi', document: 'orders' });
    const document = JSON.parse(answer.spec);
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(['/a/{slug}', '/orders', '/orders/latest', '/orders/{id}', '/orders/{id}/archive']);
    expect(answer.truncated).toBeUndefined();
  });

  it('answers one operation with only the schemas it uses, by any spelling of its route', async () => {
    const byTemplate = await call('get_spec', { service: 'orders', path: 'GET /orders/{id}' });
    const byRoute = await call('get_spec', { service: 'orders', path: 'get /orders/:param' });
    expect(byTemplate.operations).toEqual(['GET /orders/{id}']);
    expect(byRoute.spec).toBe(byTemplate.spec);
    const fragment = JSON.parse(byTemplate.spec);
    expect(Object.keys(fragment.paths)).toEqual(['/orders/{id}']);
    expect(byTemplate.next[0]).toBe('get_flow({entry: "entry:orders:http:GET:/orders/:param"})');
  });

  it('answers a channel end from the AsyncAPI document, without being told which', async () => {
    const answer = await call('get_spec', { service: 'orders', path: 'order.created' });
    expect(answer.kind).toBe('asyncapi');
    expect(answer.operations).toEqual(['send order.created']);
    expect(JSON.parse(answer.spec).asyncapi).toBe('3.0.0');
  });

  it('is bounded, and a cut document lists its operations to ask for one (I9)', async () => {
    const answer = await call('get_spec', { service: 'gateway', maxChars: 500 });
    expect(answer.spec.length).toBe(500);
    expect(answer.truncated).toMatch(/^500 of \d+ characters$/);
    expect(answer.operations.length).toBeGreaterThan(1);
    expect(answer.next[0]).toMatch(/^get_spec\(\{service: "gateway", path: "/);
  });

  it('says what it cannot answer', async () => {
    expect((await call('get_spec', { service: 'payments' })).error).toBe('no service named "payments"');
    expect((await call('get_spec', { service: 'gateway', kind: 'asyncapi' })).error).toBe('gateway has no channel end to write');
    const nowhere = await call('get_spec', { service: 'orders', path: 'DELETE /orders' });
    expect(nowhere.error).toBe('no operation of orders answers "DELETE /orders"');
    expect(nowhere.operations).toContain('POST /orders');
  });
});

describe('describe_for_prompt withSpec (P118)', () => {
  it('adds the route\'s OpenAPI fragment when asked, and only then', async () => {
    const plain = await call('describe_for_prompt', { id: 'entry:orders:http:POST:/orders' });
    const withSpec = await call('describe_for_prompt', { id: 'entry:orders:http:POST:/orders', withSpec: true, maxChars: 40000 });
    expect(plain.markdown).not.toContain('## OpenAPI');
    expect(withSpec.markdown).toContain('## OpenAPI · POST /orders');
    expect(withSpec.markdown).toContain('"openapi": "3.1.0"');
  });
});
