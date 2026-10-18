import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/** The architecture rules of `fixtures/multi-repo-rules` (P114), as an assistant is handed them. */
const CONFIG = join(resolve(import.meta.dirname, '../../../..'), 'fixtures', 'multi-repo-rules', 'flowatlas.config.json');

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

describe('check_rules (P114)', () => {
  it('lists the same violations as the CLI, each with where it crosses and the calls that show it', async () => {
    const answer = await call('check_rules');
    expect(answer.violations.map((row: { rule: string; loc: string }) => [row.rule, row.loc])).toEqual([
      ['frontends-reach-only-edge', 'src/app/orders-api.service.ts:34'],
      ['only-billing-consumes-order-events', 'src/audit/order-audit.consumer.ts:14'],
      // A transitive only (P203): orders publishing what billing consumes, other than through the gateway.
      ['only-gateway-reaches-billing', 'src/orders/orders.service.ts:49'],
      ['only-orders-writes-orders', 'src/invoices/invoices.service.ts:33'],
    ]);
    expect(answer.unchecked).toEqual([expect.objectContaining({ rule: 'typo-rule', reason: 'rule-matches-nothing' })]);
    const write = answer.violations[3];
    expect(write.next[0]).toBe('get_flow({entry: "consumer:billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated"})');
    expect(write.next[1]).toMatch(/^get_source\(\{symbol: "db_query:billing#/);
  });

  it('is bounded, and says where the next page starts', async () => {
    const answer = await call('check_rules', { maxNodes: 1 });
    expect(answer.violations).toHaveLength(1);
    expect(answer.total).toBe(4);
    expect(answer.nextOffset).toBe(1);
    expect(answer.next[0]).toBe('check_rules({maxNodes: 1, offset: 1})');
  });

  it('narrows to one rule or one service, and names the near rule for a typo', async () => {
    expect((await call('check_rules', { service: 'billing' })).violations.map((row: { rule: string }) => row.rule)).toEqual(['only-gateway-reaches-billing', 'only-orders-writes-orders']);
    const typo = await call('check_rules', { rule: 'only-orders-write-orders' });
    expect(typo.error).toBe('no rule named "only-orders-write-orders"');
    expect(typo.suggestions).toContain('only-orders-writes-orders');
  });

  it('marks the get_flow step that crosses a violated edge with the rules it breaks', async () => {
    const flow = await call('get_flow', { entry: 'entry:billing:event:order.created', maxNodes: 200 });
    const marked: string[] = [];
    const visit = (row: { node: { id: string }; violates?: string[]; children: unknown[] }): void => {
      if (row.violates !== undefined) marked.push(`${row.node.id} ${row.violates.join(',')}`);
      for (const child of row.children as Array<typeof row>) visit(child);
    };
    visit(flow.root);
    expect(marked.some((line) => line.startsWith('table:billing#orders') && line.endsWith('only-orders-writes-orders'))).toBe(true);
  });

  it('writes the rules a node is on into describe_for_prompt, and counts the errors in start_here and findings', async () => {
    const prompt = await call('describe_for_prompt', { id: 'billing', scope: 'service' });
    expect(prompt.markdown).toContain('## Rules it breaks · 2');
    expect(prompt.markdown).toContain('`only-orders-writes-orders` · error: billing writes table orders (billing), which only service orders may at billing `src/invoices/invoices.service.ts:33`. Why: orders owns its table; everyone else asks orders');
    const start = await call('start_here');
    expect(start.rules).toEqual({ errors: 4, warnings: 0, unchecked: 1 });
    expect(start.next[0]).toBe('check_rules()');
    const findings = await call('findings', { kind: 'rule' });
    expect(findings.rows.map((row: { message: string }) => row.message.split(':')[0])).toHaveLength(4);
    expect(findings.rows[0].next).toMatch(/^check_rules\(\{rule: /);
  });
});
