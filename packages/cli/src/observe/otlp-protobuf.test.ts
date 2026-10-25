import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
// The protobuf writer the sender script uses too: it writes every field, so the decoder is shown to skip them.
import { encodeTraceRequest } from '../../../../scripts/otlp-encode.mjs';
import { readTraceFiles } from '../commands/observe.js';
import { PLANTED } from './__fixtures__/planted.js';
import { decodeTraceRequest, ProtobufError } from './otlp-protobuf.js';
import { OTLP_KEEP, otlpReader } from './readers/index.js';

type Json = Record<string, any>;

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo/traces/checkout.otlp.json');
const json = readFileSync(fixture, 'utf8');
const document = JSON.parse(json) as Json;
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-protobuf-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('OTLP protobuf', () => {
  const bytes = encodeTraceRequest(document);

  it('decodes to the spans the JSON reads to', () => {
    const decoded = otlpReader.read(decodeTraceRequest(bytes, OTLP_KEEP));
    const read = otlpReader.read(document);
    expect(decoded.spans).toEqual(read.spans);
    expect(decoded.skipped).toEqual(read.skipped);
    // The same attributes went unread, counted while decoding instead of while reading.
    expect(decoded.droppedAttributes).toBe(read.droppedAttributes);
    expect(decoded.spans.find((one) => one.spanId === 'c200000000000001')).toMatchObject({ status: 500, error: true, durationMs: 35 });
  });

  it('never decodes a key off the list: a header put in the bytes is not in the output, nor its value', () => {
    const decoded = decodeTraceRequest(bytes, OTLP_KEEP);
    const text = JSON.stringify(decoded);
    // Off the list, so never decoded: a header, a user, a cookie, a statement, an exception, a status message.
    for (const secret of ['not-a-real-token', 'user-7781', 'cookie-val-55', 'secret-stmt-8', 'duplicate key', 'insert failed']) {
      expect(text).not.toContain(secret);
    }
    // A URL is on the list and is reduced to its path's shape by the reader, as from JSON.
    const read = JSON.stringify(otlpReader.read(decoded));
    for (const secret of PLANTED) expect(read).not.toContain(secret);
    expect(text).not.toContain('http.request.header');
    expect(text).not.toContain('enduser');
    expect(text).not.toContain('db.statement');
    // Span names and the status message are skipped as bytes.
    expect(text).not.toContain('"name"');
    expect(text).not.toContain('message');
  });

  it('refuses a truncated request or an unknown wire type, saying where', () => {
    expect(() => decodeTraceRequest(bytes.subarray(0, bytes.length - 7), OTLP_KEEP)).toThrow(ProtobufError);
    expect(() => decodeTraceRequest(new Uint8Array([0x0b, 0x00]), OTLP_KEEP)).toThrow(/wire type 3 at byte 0/);
  });

  it('is read from a .pb file, and gzipped, to the same spans as the JSON', () => {
    const pb = join(scratch, 'checkout.otlp.pb');
    writeFileSync(pb, bytes);
    const gz = join(scratch, 'checkout.bin.gz');
    writeFileSync(gz, gzipSync(bytes));
    const lines = join(scratch, 'checkout.jsonl');
    writeFileSync(lines, `${JSON.stringify(document)}\n${JSON.stringify({ resourceSpans: [] })}\n`);
    const expected = readTraceFiles([fixture]).spans;
    expect(readTraceFiles([pb]).spans).toEqual(expected);
    expect(readTraceFiles([gz]).spans).toEqual(expected);
    expect(readTraceFiles([lines]).spans).toEqual(expected);
    expect(readTraceFiles([pb]).sources[0]).toMatchObject({ format: 'otlp', spans: expected.length });
  });

  it('decodes a list attribute only under a key read as a list (P107)', () => {
    const lambda = JSON.parse(
      readFileSync(join(dirname(fixture), '../../lambda-traces/traces/adot.otlp.json'), 'utf8'),
    ) as Json;
    const decoded = otlpReader.read(decodeTraceRequest(encodeTraceRequest(lambda), OTLP_KEEP));
    expect(decoded.spans).toEqual(otlpReader.read(lambda).spans);
    expect(decoded.spans.filter((one) => one.tables !== undefined).map((one) => one.tables)).toEqual([['orders'], ['carts'], ['orders'], ['orders']]);
    // A list under a key read as one string is skipped as bytes.
    const listed = { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'aa', spanId: 'bb', kind: 3, attributes: [
      { key: 'rpc.service', value: { arrayValue: { values: [{ stringValue: 'not-a-list-key' }] } } },
    ] }] }] }] };
    expect(JSON.stringify(decodeTraceRequest(encodeTraceRequest(listed), OTLP_KEEP))).not.toContain('not-a-list-key');
  });

  it('names a file that is neither JSON nor a trace request, with the byte', () => {
    const junk = join(scratch, 'junk.pb');
    writeFileSync(junk, Buffer.from([0x0a, 0x10, 0x01]));
    expect(() => readTraceFiles([junk])).toThrow(/junk\.pb is not an OTLP trace request \(byte 2\)/);
    const brace = join(scratch, 'broken.json');
    writeFileSync(brace, '{ "resourceSpans": [');
    expect(() => readTraceFiles([brace])).toThrow(/broken\.json is not JSON/);
  });
});
