import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { apigwAccessLogReader } from './apigw-access-log.js';
import { readerFor } from './index.js';

const exports = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/lambda-traces/exports');
const lines = readFileSync(join(exports, 'checkout.access-log.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record<string, unknown>);

const PLANTED = ['planted', '203.0.113.7', '198.51.100.23', 'k7x9q2w1ab', 'amazonaws', 'HTTP/1.1', 'sourceIp', 'principal'];

describe('the API Gateway access log reader', () => {
  it('reads a JSON line with a route key or a method and resource path, and a status', () => {
    expect(readerFor(lines[0])).toBe(apigwAccessLogReader);
    expect(readerFor({ httpMethod: 'GET', resourcePath: '/orders/{id}', status: 200 })).toBe(apigwAccessLogReader);
    expect(readerFor({ routeKey: 'GET /orders' })).toBeUndefined();
  });

  it("reads an HTTP API's line: the route key, the status, the response latency, the request time", () => {
    const { spans, droppedAttributes } = apigwAccessLogReader.read(lines[0], undefined, { part: 0 });
    expect(spans).toEqual([
      {
        traceId: 'apigw:0',
        spanId: 'apigw:0',
        kind: 'server',
        method: 'POST',
        route: '/checkout',
        at: '2025-10-16T08:29:59.000Z',
        status: 201,
        durationMs: 187,
        sampleable: false,
      },
    ]);
    // ip, requestId, extendedRequestId, protocol, responseLength, userAgent, domainName, identity, authorizer.
    expect(droppedAttributes).toBe(9);
  });

  it('reads $default as the path, through the path reducer, at the epoch time', () => {
    const [span] = apigwAccessLogReader.read(lines[1], 'shop', { part: 1 }).spans;
    expect(span).toEqual({
      traceId: 'apigw:1',
      spanId: 'apigw:1',
      kind: 'server',
      service: 'shop',
      method: 'GET',
      path: '/favicon.ico',
      at: '2025-10-16T08:30:02.000Z',
      status: 404,
      durationMs: 3,
      sampleable: false,
    });
  });

  it("reads a REST API's line by its resource path, and an integration's 5xx as an error", () => {
    const [span] = apigwAccessLogReader.read({
      HTTPMETHOD: 'get',
      ResourcePath: '/orders/{id}',
      path: '/live/orders/ord-1',
      status: '502',
      integrationLatency: '29000',
      integrationStatus: '504',
      requestTimeEpoch: '1760603400',
    }).spans;
    expect(span).toMatchObject({ method: 'GET', route: '/orders/{id}', status: 502, durationMs: 29000, error: true, at: '2025-10-16T08:30:00.000Z' });
    expect(span).not.toHaveProperty('path');
  });

  it("takes an ANY route's method from the request, and keys a team named otherwise from --access-log-keys", () => {
    expect(apigwAccessLogReader.read({ routeKey: 'ANY /cart', httpMethod: 'DELETE', status: 204 }).spans[0]).toMatchObject({ method: 'DELETE', route: '/cart' });
    const custom = { rk: 'PUT /cart/{id}', code: 200, took: '12.5', when: '16/Oct/2025:10:30:00 +0200', ipAddress: '203.0.113.7' };
    const keys = { route: 'rk', status: 'code', latency: 'took', time: 'when' };
    expect(readerFor(custom)).toBeUndefined();
    expect(readerFor(custom, { accessLogKeys: keys })).toBe(apigwAccessLogReader);
    const { spans, droppedAttributes } = apigwAccessLogReader.read(custom, undefined, { accessLogKeys: keys });
    expect(spans[0]).toMatchObject({ method: 'PUT', route: '/cart/{id}', status: 200, durationMs: 12.5, at: '2025-10-16T08:30:00.000Z' });
    expect(droppedAttributes).toBe(1);
  });

  it('reads the lines out of a CloudWatch Logs export, and counts a message that is not one', () => {
    const exported = {
      events: [
        { logStreamName: 'planted-stream', timestamp: 1760603400000, message: JSON.stringify(lines[0]), ingestionTime: 1, eventId: 'planted-ev' },
        { logStreamName: 'planted-stream', timestamp: 1760603401000, message: 'not json, planted' },
      ],
    };
    expect(readerFor(exported)).toBe(apigwAccessLogReader);
    const { spans, skipped } = apigwAccessLogReader.read(exported, undefined, { part: 2 });
    expect(spans.map(({ spanId, method, route }) => [spanId, method, route])).toEqual([['apigw:2:0', 'POST', '/checkout']]);
    expect(skipped).toEqual([{ noun: 'line', why: 'not holding an access log line', count: 1 }]);
    const insights = [{ '@timestamp': '2025-10-16 08:31:00.000', '@message': JSON.stringify({ routeKey: '$default', path: '/x', httpMethod: 'GET', status: '404' }) }];
    expect(apigwAccessLogReader.read(insights).spans[0]).toMatchObject({ path: '/x', at: '2025-10-16T08:31:00.000Z' });
  });

  it('keeps no address, user agent, identity, authorizer, request id or domain', () => {
    const text = JSON.stringify(lines.map((line, part) => apigwAccessLogReader.read(line, undefined, { part })));
    for (const secret of PLANTED) expect(text, secret).not.toContain(secret);
  });
});
