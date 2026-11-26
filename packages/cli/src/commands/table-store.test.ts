import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ProjectGraph } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-table-store-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** A ledger whose functions write their table through a store of version 2 nobody installed. */
const FILES: Record<string, string> = {
  'flowatlas.config.json': JSON.stringify({ services: [{ name: 'ledger', repo: './ledger', type: 'lambda' }], output: '.flowatlas' }),
  'ledger/package.json': JSON.stringify({ name: 'ledger', version: '1.0.0', private: true, dependencies: { 'aws-sdk': '^2.1000.0' } }),
  'ledger/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'es2020', module: 'commonjs', esModuleInterop: true, strict: false }, include: ['src'] }),
  'ledger/src/store.ts': `import AWS from 'aws-sdk';

/** A table store each table's class extends, told its table on every call. */
export class TableStore<T> {
  private client;

  constructor(private readonly label: string) {
    this.client = new AWS.DynamoDB();
  }

  async save(table: string, model: T, extra?: any): Promise<any> {
    const params = Object.assign({ TableName: table, Item: AWS.DynamoDB.Converter.marshall(model) }, extra);
    return this.client.putItem(params).promise();
  }
}
`,
  'ledger/src/entries.ts': `import { TableStore } from './store';

export interface Entry { id: string; amount: number }

/** The ledger's entries, written to the table the environment names. */
export class EntryLog extends TableStore<Entry> {
  private static readonly table = process.env.ENTRY_TABLE;

  constructor() {
    super('entries');
  }

  async append(entry: Entry): Promise<void> {
    return super.save(EntryLog.table, entry, { ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } });
  }
}

/** Built by a container this reads nothing of, so no function is seen running it. */
export const container = { get: (name: string): unknown => (name === 'log' ? new EntryLog() : undefined) };
`,
  'ledger/src/append.ts': `import { container } from './entries';

export const handler = async (event: { body: string }) => {
  const log = container.get('log') as { append(entry: unknown): Promise<void> };
  await log.append(JSON.parse(event.body));
  return { statusCode: 201 };
};
`,
  'ledger/src/entry-changed.ts': 'export const handler = async (event: { Records: unknown[] }) => event.Records.length;\n',
  'ledger/template.yaml': `AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Globals:
  Function:
    Runtime: nodejs20.x
    CodeUri: src/
    Environment:
      Variables:
        ENTRY_TABLE: !Ref EntryTable
Resources:
  EntryTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: ledger-entries
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH
      StreamSpecification:
        StreamViewType: NEW_IMAGE
  Append:
    Type: AWS::Serverless::Function
    Properties:
      Handler: append.handler
      Events:
        Post:
          Type: Api
          Properties:
            Path: /entries
            Method: post
  EntryChanged:
    Type: AWS::Serverless::Function
    Properties:
      Handler: entry-changed.handler
      Events:
        Entries:
          Type: DynamoDB
          Properties:
            Stream: !GetAtt EntryTable.StreamArn
            StartingPosition: LATEST
`,
};

/**
 * A table written through a store of version 2 (P299): the client a field
 * its constructor gives `new AWS.DynamoDB()` with nothing installed, the
 * input put together with `Object.assign` over what the caller hands in, the
 * table a static field of the class extending the store, read from the
 * environment every function of the deployment is given - and the store a
 * data layer something was read through.
 */
describe('a table written through a store of version 2 (P299)', () => {
  let graph: ProjectGraph;

  beforeAll(async () => {
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
    await buildProject({ config: join(scratch, 'flowatlas.config.json'), builtAt: '2026-01-01T00:00:00.000Z' });
    graph = JSON.parse(readFileSync(join(scratch, '.flowatlas', 'project-graph.json'), 'utf8')) as ProjectGraph;
  }, 120_000);

  it('draws the write where the table is decided, onto the table its stream is read from', () => {
    const producer = graph.nodes.find((node) => node.type === 'producer');
    expect(producer).toMatchObject({ file: 'src/entries.ts', line: 14 });
    const emits = graph.edges.filter((edge) => edge.from === producer?.id && edge.type === 'emits');
    expect(emits.map((edge) => edge.to)).toEqual(['channel:dynamodb/ledger-entries']);
    expect(emits[0]).toMatchObject({ confidence: 'heuristic', meta: { variables: ['ENTRY_TABLE'], everyFunction: true } });
  });

  it('says neither that nothing writes the stream nor that nothing was read through the store', () => {
    const reasons = graph.unresolved.map((row) => row.reason);
    expect(reasons).not.toContain('stream-no-writer');
    expect(reasons).not.toContain('db-layer-unread');
  });
});
