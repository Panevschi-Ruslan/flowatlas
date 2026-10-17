#!/usr/bin/env node
/**
 * Posts synthetic traffic to `flowatlas observe --listen` (dev only, not
 * packaged), the way the exporters do: OTLP/HTTP traces as JSON, protobuf
 * and gzip, one post per resource as an SDK batches them, and each
 * @nestjs/observe batch as the agent posts it, with a credentials header
 * the listener must never read. Used by the listener's test and to try it by
 * hand:
 *
 *   flowatlas observe --listen &
 *   node scripts/observe-send.mjs                       # fixtures/multi-repo/traces
 *   node scripts/observe-send.mjs --to http://127.0.0.1:4318 fixtures/lambda-traces/traces/adot.otlp.json
 *
 * It reads only the files named and posts only to `--to`.
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { encodeTraceRequest } from './otlp-encode.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_URL = 'http://127.0.0.1:4318';

export const DEFAULT_FILES = [
  join(root, 'fixtures/multi-repo/traces/checkout.otlp.json'),
  join(root, 'fixtures/multi-repo/traces/billing.observe.json'),
  join(root, 'fixtures/multi-repo/traces/billing.batches.observe.json'),
];

/** How the OTLP posts are written, in turn. */
export const ENCODINGS = ['json', 'protobuf', 'gzip-json', 'gzip-protobuf'];

/** What an exporter puts in a header to be let in; the listener never reads it. */
export const SENDER_SECRET = 'sender-credential-never-read';

const CREDENTIALS = { authorization: `Bearer ${SENDER_SECRET}`, 'x-api-key': SENDER_SECRET };

const documentsIn = (file) => {
  const text = readFileSync(file, 'utf8');
  try {
    return [JSON.parse(text)];
  } catch {
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  }
};

const otlpRequest = (document, encoding) => {
  const protobuf = encoding.endsWith('protobuf');
  const raw = protobuf ? Buffer.from(encodeTraceRequest(document)) : Buffer.from(JSON.stringify(document));
  const gzip = encoding.startsWith('gzip');
  return {
    path: '/v1/traces',
    label: `traces ${encoding}`,
    headers: {
      'content-type': protobuf ? 'application/x-protobuf' : 'application/json',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
      ...CREDENTIALS,
    },
    body: gzip ? gzipSync(raw) : raw,
  };
};

const batchRequest = (batch, gzip) => {
  const raw = Buffer.from(JSON.stringify(batch));
  return {
    path: '/applications/telemetry',
    label: `batch${gzip ? ' gzip' : ''}`,
    headers: { 'content-type': 'application/json', ...(gzip ? { 'content-encoding': 'gzip' } : {}), ...CREDENTIALS },
    body: gzip ? gzipSync(raw) : raw,
  };
};

/**
 * The posts the files make: an OTLP document one post per `resourceSpans`
 * (each service's exporter posts its own), in the encodings in turn from
 * `start`; a @nestjs/observe batch, or each batch of a saved series, one post
 * each, every other one gzipped.
 */
export const requestsFor = (files, { start = 0 } = {}) => {
  const requests = [];
  let otlp = start;
  let batches = 0;
  for (const file of files) {
    for (const document of documentsIn(file)) {
      if (Array.isArray(document.resourceSpans)) {
        for (const resourceSpans of document.resourceSpans) {
          requests.push(otlpRequest({ resourceSpans: [resourceSpans] }, ENCODINGS[otlp % ENCODINGS.length]));
          otlp += 1;
        }
      } else if (Array.isArray(document.batches) || Array.isArray(document.snapshots)) {
        for (const batch of document.batches ?? [document]) {
          requests.push(batchRequest(batch, batches % 2 === 1));
          batches += 1;
        }
      } else {
        throw new Error(`${file} is neither OTLP/JSON nor a @nestjs/observe batch`);
      }
    }
  }
  return requests;
};

/** What an SDK exporting everything also posts: metrics and logs, which the listener drops unread. */
export const extraRequests = () => [
  {
    path: '/v1/metrics',
    label: 'metrics json',
    headers: { 'content-type': 'application/json', ...CREDENTIALS },
    body: Buffer.from(JSON.stringify({ resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }] })),
  },
  {
    path: '/v1/logs',
    label: 'logs protobuf',
    headers: { 'content-type': 'application/x-protobuf', ...CREDENTIALS },
    body: Buffer.from([0x0a, 0x00]),
  },
];

/** One post; resolves with the status and the body answered. */
export const post = (url, { path, headers, body }) =>
  new Promise((resolve, reject) => {
    const target = new URL(path, url);
    const sent = request(
      target,
      { method: 'POST', headers: { ...headers, 'content-length': String(body.length) } },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
        response.on('error', reject);
      },
    );
    sent.on('error', reject);
    sent.end(body);
  });

/** Every post in order, one after another. */
export const sendAll = async (url, requests) => {
  const answers = [];
  for (const one of requests) answers.push({ label: one.label, path: one.path, ...(await post(url, one)) });
  return answers;
};

const main = async (argv) => {
  let url = DEFAULT_URL;
  let extras = true;
  const files = [];
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--to') url = argv[++at];
    else if (argv[at] === '--no-extras') extras = false;
    else files.push(argv[at]);
  }
  const requests = [...requestsFor(files.length === 0 ? DEFAULT_FILES : files), ...(extras ? extraRequests() : [])];
  const answers = await sendAll(url, requests);
  for (const answer of answers) process.stdout.write(`${answer.status} ${answer.path} (${answer.label})\n`);
  const failed = answers.filter((answer) => answer.status < 200 || answer.status > 299);
  process.stdout.write(`${answers.length} posts to ${url}, ${failed.length} refused\n`);
  if (failed.length > 0) process.exitCode = 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
