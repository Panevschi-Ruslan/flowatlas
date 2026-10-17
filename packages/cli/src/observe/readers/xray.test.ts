import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readerFor } from './index.js';
import { xrayReader } from './xray.js';

const exports = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/lambda-traces/exports');
const output = JSON.parse(readFileSync(join(exports, 'xray.batch-get-traces.json'), 'utf8')) as unknown;
const read = xrayReader.read(output);
const span = (id: string) => read.spans.find((one) => one.spanId === id)!;

/** What the fixture planted in the segment documents, none of which may leave the reader. */
const PLANTED = ['planted', 'PLANTED', '111122223333', 'eu-west-1', 'arn:', 'amazonaws', '203.0.113.7', 'k7x9q2w1ab', 'promo', 'Invocation', 'Overhead'];

const segment = (fields: Record<string, unknown>) => ({ Traces: [{ Segments: [{ Document: JSON.stringify({ trace_id: '1-t', start_time: 1, ...fields }) }] }] });

describe('the X-Ray reader', () => {
  it('reads batch-get-traces output, an array of outputs and a bare array of segment documents', () => {
    expect(readerFor(output)).toBe(xrayReader);
    expect(readerFor([output, output])).toBe(xrayReader);
    expect(readerFor([{ id: 's1', trace_id: '1-t', start_time: 1 }])).toBe(xrayReader);
    expect(readerFor({ Traces: 'no' })).toBeUndefined();
  });

  it('reads a stage as the route it served, without the stage, the host or the query', () => {
    expect(span('a000000000000001')).toEqual({
      traceId: '1-68f0ad08-a1b2c3d4e5f6a7b8c9d0e1f2',
      spanId: 'a000000000000001',
      kind: 'server',
      method: 'POST',
      path: '/checkout',
      at: '2025-10-16T08:29:59.997Z',
      status: 201,
      durationMs: 187,
    });
  });

  it("reads a function's segment by its ARN or its name, hung on what ran it, and its trigger from that", () => {
    // The `AWS::Lambda` segment between the stage and the function is read through.
    expect(span('c100000000000001')).toMatchObject({ kind: 'server', service: 'checkout', faas: 'checkout', parentId: 'a000000000000001', trigger: 'http', durationMs: 180 });
    expect(span('9100000000000001')).toMatchObject({ faas: 'index-orders', parentId: 'c100000000000002', trigger: 'datasource' });
    expect(span('d100000000000001')).toMatchObject({ faas: 'ship-order', parentId: 'c100000000000003', trigger: 'pubsub' });
    expect(span('a100000000000001')).toMatchObject({ faas: 'reserve-stock', parentId: 'f100000000000012', trigger: 'other' });
    // `fault` is the error; the exception's text in `cause` is not read.
    expect(span('b100000000000001')).toMatchObject({ faas: 'charge-card', error: true });
    expect(read.spans.some((one) => one.spanId.endsWith('0a') || one.spanId.endsWith('0b'))).toBe(false);
  });

  it("reads a state machine's segment as the run, its direct subsegments as steps", () => {
    expect(span('f100000000000001')).toMatchObject({ kind: 'server', service: 'fulfil-order', workflow: 'fulfil-order', parentId: 'c100000000000004' });
    expect(['f100000000000002', 'f100000000000003', 'f100000000000004', 'f100000000000006'].map((id) => span(id).state)).toEqual([
      'ReserveStock',
      'ChargeCard',
      'MarkPaid',
      'SendReceipt',
    ]);
    expect(span('f100000000000004')).toMatchObject({ kind: 'internal', workflow: 'fulfil-order', parentId: 'f100000000000001', durationMs: 90 });
  });

  it('reads DynamoDB, SQS, SNS, Lambda and Step Functions subsegments into the fields an OTLP span of them has', () => {
    expect(span('c100000000000002')).toMatchObject({ kind: 'client', rpc: 'DynamoDB/PutItem', awsOp: 'PutItem', tables: ['orders'], transport: 'dynamodb', faas: 'checkout' });
    expect(span('c100000000000003')).toMatchObject({ rpc: 'SQS/SendMessage', destination: 'order-placed', transport: 'sqs' });
    expect(span('c100000000000004')).toMatchObject({ rpc: 'SFN/StartExecution', workflow: 'fulfil-order' });
    expect(span('f100000000000005')).toMatchObject({ rpc: 'DynamoDB/UpdateItem', tables: ['orders'], parentId: 'f100000000000004' });
    expect(span('f100000000000007')).toMatchObject({ rpc: 'SNS/Publish', destination: 'receipts', transport: 'sns' });
    expect(span('f100000000000013')).toMatchObject({ rpc: 'Lambda/Invoke', invokes: 'charge-card', parentId: 'f100000000000003' });
    // Under the `Invocation` subsegment, which is read through.
    expect(span('d100000000000004')).toMatchObject({ rpc: 'Lambda/Invoke', invokes: 'print-label', parentId: 'd100000000000001' });
    expect(span('c100000000000006')).toMatchObject({ rpc: 'SecretsManager/GetSecretValue', awsOp: 'GetSecretValue' });
  });

  it("reads an AWS service's inferred segment as the callee's side, and nothing of a remote host's", () => {
    expect(span('e0000000000000d1')).toEqual({
      traceId: '1-68f0ad08-a1b2c3d4e5f6a7b8c9d0e1f2',
      spanId: 'e0000000000000d1',
      parentId: 'c100000000000002',
      service: 'DynamoDB',
      kind: 'server',
      at: '2025-10-16T08:30:00.006Z',
      status: 200,
      durationMs: 18,
    });
    const remote = xrayReader.read(segment({ id: 'r1', parent_id: 'x', name: 'pay.example.test', inferred: true, origin: 'Remote' }));
    expect(remote.spans).toEqual([]);
    expect(remote.skipped).toEqual([{ noun: 'segment', why: 'inferred for a remote host (its name is the host)', count: 1 }]);
  });

  it('reads a remote call by its method and path shape, never its host or its statement', () => {
    const { spans } = xrayReader.read(
      segment({
        id: 'app1',
        name: 'orders-api',
        http: { request: { method: 'get', url: 'https://api.example.test/orders/ord-1?x=planted' } },
        subsegments: [
          { id: 'rem1', name: 'pay.example.test', namespace: 'remote', http: { request: { method: 'POST', url: 'https://pay.example.test/charges?k=planted' }, response: { status: 402 } }, error: true },
          { id: 'sql1', name: 'db.example.test', namespace: 'remote', sql: { url: 'postgresql://db.example.test/planted', sanitized_query: 'SELECT planted' } },
        ],
      }),
    );
    expect(spans).toEqual([
      { traceId: '1-t', spanId: 'app1', kind: 'server', service: 'orders-api', method: 'GET', path: '/orders/:value', at: '1970-01-01T00:00:01.000Z' },
      // A 4xx's `error` is not an error: its status is kept.
      { traceId: '1-t', spanId: 'rem1', parentId: 'app1', kind: 'client', service: 'orders-api', method: 'POST', path: '/charges', status: 402 },
    ]);
  });

  it('counts a document that does not parse, and the nodes it reads through', () => {
    const broken = xrayReader.read({ Traces: [{ Segments: [{ Document: '{"id": "s1", "trace_' }] }] });
    expect(broken).toEqual({ spans: [], skipped: [{ noun: 'segment', why: 'whose document is not JSON', count: 1 }], droppedAttributes: 0 });
    expect(read.skipped).toEqual([
      { noun: 'segment', why: 'of origin AWS::Lambda, read through to the function segment under it', count: 6 },
      { noun: 'subsegment', why: 'naming no call, read through to the calls under them', count: 14 },
    ]);
  });

  it('cuts an execution ARN to its workflow, and keeps a step name only up to the longest a step can have', () => {
    const { spans } = xrayReader.read(
      segment({
        id: 'm1',
        name: 'renamed-in-console',
        origin: 'AWS::StepFunctions::StateMachine',
        resource_arn: 'arn:aws:states:eu-west-1:111122223333:express:fulfil-order:run-9:abc',
        subsegments: [{ id: 's1', name: 'x'.repeat(81) }],
      }),
    );
    expect(spans.map((one) => [one.workflow, one.state])).toEqual([
      ['fulfil-order', undefined],
      ['fulfil-order', undefined],
    ]);
  });

  it('keeps no annotation, metadata, statement, cause, request id, account, region, client address or user', () => {
    const text = JSON.stringify(read);
    for (const secret of PLANTED) expect(text, secret).not.toContain(secret);
    // annotations, metadata, user, cause, aws.request_id, aws.account_id, aws.region, aws.xray, sql, client_ip, ...
    expect(read.droppedAttributes).toBeGreaterThan(60);
  });
});
