import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readerFor } from './index.js';
import { lambdaReportReader } from './lambda-report.js';
import { csvRows } from './log-records.js';
import { NameNeeded } from './shared.js';

const exports = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/lambda-traces/exports');
const insightsJson = JSON.parse(readFileSync(join(exports, 'report-lines.insights.json'), 'utf8')) as unknown;
const insightsCsv = readFileSync(join(exports, 'report-lines.insights.csv'), 'utf8');

const PLANTED = ['planted', '111122223333', 'RequestId', 'Billed', 'Memory', '512', 'XRAY', 'SegmentId', '312.77', 'INFO', 'START'];

const runs = (spans: ReturnType<typeof lambdaReportReader.read>['spans']) =>
  spans.map(({ faas, durationMs, error, at }) => [faas, durationMs, error ?? false, at]);

const EXPECTED = [
  ['checkout', 180, false, '2025-10-16T08:30:00.180Z'],
  ['reserve-stock', 200, false, '2025-10-16T08:30:00.290Z'],
  ['charge-card', 270, true, '2025-10-16T08:30:00.590Z'],
  ['ship-order', 400, false, '2025-10-16T08:30:01.400Z'],
  // In a log group of the team's own: the stream names it.
  ['print-label', 320, false, '2025-10-16T08:30:01.370Z'],
  ['index-orders', 20, false, '2025-10-16T08:30:01.520Z'],
];

describe('the Lambda REPORT line reader', () => {
  it('reads a Logs Insights export as JSON and as CSV, and plain REPORT lines', () => {
    expect(readerFor(insightsJson)).toBe(lambdaReportReader);
    expect(readerFor(insightsCsv)).toBe(lambdaReportReader);
    expect(readerFor('REPORT RequestId: r1\tDuration: 3.00 ms\n')).toBe(lambdaReportReader);
    expect(readerFor('START RequestId: r1\nEND RequestId: r1\n')).toBeUndefined();
  });

  it('reads one run per REPORT line, the function from its log group, and only Duration and Status', () => {
    const json = lambdaReportReader.read(insightsJson);
    expect(runs(json.spans)).toEqual(EXPECTED);
    expect(json.spans[0]).toEqual({
      traceId: 'report:0:0',
      spanId: 'report:0:0',
      kind: 'server',
      service: 'checkout',
      at: '2025-10-16T08:30:00.180Z',
      durationMs: 180,
      faas: 'checkout',
      sampleable: false,
    });
    expect(json.skipped).toEqual([{ noun: 'line', why: 'not starting REPORT', count: 2 }]);
    // The CSV download has no @duration column: the duration is read off the line, not the billed one.
    const csv = lambdaReportReader.read(insightsCsv);
    expect(runs(csv.spans)).toEqual(EXPECTED);
  });

  it('reads a timeout as an error, and a plain line with --function, its time when aws logs tail printed one', () => {
    const plain = [
      '2025-10-16T08:30:05.000000+00:00 2025/10/16/[$LATEST]abc REPORT RequestId: r1\tDuration: 3000.00 ms\tBilled Duration: 3000 ms\tMemory Size: 128 MB\tMax Memory Used: 64 MB\tStatus: timeout',
      'REPORT RequestId: r2\tDuration: 12.34 ms\tBilled Duration: 13 ms\tMemory Size: 128 MB\tMax Memory Used: 64 MB\tInit Duration: 99.00 ms',
      'END RequestId: r2',
    ].join('\n');
    const { spans, skipped } = lambdaReportReader.read(plain, undefined, { function: 'checkout', part: 3 });
    expect(spans.map(({ spanId, faas, durationMs, error, at }) => ({ spanId, faas, durationMs, error, at }))).toEqual([
      { spanId: 'report:3:0', faas: 'checkout', durationMs: 3000, error: true, at: '2025-10-16T08:30:05.000Z' },
      { spanId: 'report:3:1', faas: 'checkout', durationMs: 12.34, error: undefined, at: undefined },
    ]);
    expect(skipped).toEqual([{ noun: 'line', why: 'not starting REPORT', count: 1 }]);
  });

  it('refuses lines no log group names the function of, unless --function does', () => {
    const lines = 'REPORT RequestId: r1\tDuration: 3.00 ms\n';
    expect(() => lambdaReportReader.read(lines)).toThrow(NameNeeded);
    const exported = { events: [{ timestamp: 1760603400000, message: lines }] };
    expect(() => lambdaReportReader.read(exported)).toThrow(/1 REPORT line no log group names/);
    expect(lambdaReportReader.read(exported, undefined, { function: 'checkout' }).spans[0]).toMatchObject({
      faas: 'checkout',
      at: '2025-10-16T08:30:00.000Z',
    });
  });

  it("names each line by its own log group in an export of several functions, and a Lambda@Edge copy by the function's name", () => {
    const rows = [
      { '@log': '111122223333:/aws/lambda/us-east-1.edge-auth', '@message': 'REPORT RequestId: r1\tDuration: 1.00 ms' },
      { '@log': '111122223333:/aws/lambda/checkout', '@message': 'REPORT RequestId: r2\tDuration: 2.00 ms' },
    ];
    expect(lambdaReportReader.read(rows, undefined, { function: 'ignored' }).spans.map((span) => span.faas)).toEqual(['edge-auth', 'checkout']);
  });

  it('parses CSV by RFC 4180: quoted commas, doubled quotes, line breaks inside quotes, CRLF', () => {
    expect(csvRows('a,b,c\r\n"x, y","say ""hi""","two\r\nlines"\r\n,,\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\r\nlines'],
    ]);
  });

  it('keeps no request id, billed duration, memory figure, init duration, X-Ray id or other log line', () => {
    const text = JSON.stringify([lambdaReportReader.read(insightsJson), lambdaReportReader.read(insightsCsv)]);
    for (const secret of PLANTED) expect(text, secret).not.toContain(secret);
  });
});
