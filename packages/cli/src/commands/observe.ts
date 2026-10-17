import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  describeObservedProblem,
  mergeObserved,
  OBSERVED_FORMAT_VERSION,
  parseDuration,
  type GraphNode,
  type HitSeen,
  type ObservedSource,
} from '@flowatlas/core';
import type { Command } from 'commander';
import { dbPathFor, openDbFromOptions, type DbOptions } from '../db.js';
import { cannotRun } from '../exit.js';
import { indexGraph, matchSpans, type Observed } from '../observe/match.js';
import { decodeTraceRequest, ProtobufError } from '../observe/otlp-protobuf.js';
import { OTLP_KEEP, readerFor, type SkippedPart } from '../observe/readers.js';
import type { ObservedSpan } from '../observe/span.js';
import { readObservedBeside, saveObserved } from '../observe/store.js';

export interface ObserveOptions extends DbOptions {
  /** Service a span belongs to when the file does not say. */
  service?: string;
  format?: string;
  /** `--since <dur>`: keep only the hours inside it; `all` stops cutting. */
  since?: string;
  /** `--reset`: start from an empty file. */
  reset?: boolean;
  /** `--no-samples` sets this false: no sample is written, and the file's are removed. */
  samples?: boolean;
  print?: (message: string) => void;
  /** The clock, for the window and `readAt`; tests and snapshots fix it. */
  now?: Date;
}

export interface ObserveRun {
  path: string;
  /** The file as written: what was there, this run added, and the window cut. */
  observed: Observed;
  /** Spans read by this run. */
  spans: number;
  /** Format read, by file. */
  formats: Record<string, string>;
  /** What the readers saw and did not read, summed over the files. */
  skipped: SkippedPart[];
  /** Files left alone because their contents were already read into the file. */
  repeated: string[];
  /** The version of the file this run upgraded, when it was older. */
  upgradedFrom?: number;
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** gzip's magic number: a captured POST body from the SDK is read as it is. */
const isGzip = (bytes: Buffer): boolean => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/** Names the OTLP file and collector exporters give protobuf. */
const PROTOBUF_EXTENSIONS: ReadonlySet<string> = new Set(['.pb', '.binpb', '.protobuf']);

/** A file's bytes, unpacked when gzip, and the hash it is known by. */
const bytesOf = (file: string): { bytes: Buffer; sha256: string } => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (cause) {
    throw cannotRun(`cannot read ${file}: ${messageOf(cause)}`);
  }
  if (isGzip(bytes)) {
    try {
      bytes = gunzipSync(bytes);
    } catch (cause) {
      throw cannotRun(`${file} is gzip and cannot be unpacked: ${messageOf(cause)}`);
    }
  }
  // The unpacked bytes: the same export gzipped or not is one source.
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
};

const jsonDocuments = (source: string): unknown[] | undefined => {
  try {
    return [JSON.parse(source)];
  } catch {
    try {
      return source
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as unknown);
    } catch {
      return undefined;
    }
  }
};

/** Whether text starts the way a JSON document does, after a byte-order mark and white space. */
const looksLikeJson = (source: string): boolean => /^\uFEFF?\s*[{[]/.test(source);

/**
 * A trace file is one JSON document, or one per line as the OTLP file
 * exporter writes, or an OTLP protobuf request; any of them may be gzipped. A
 * `.pb` file is tried as protobuf first, anything else as JSON first.
 */
const documentsOf = (file: string, bytes: Buffer): unknown[] => {
  const protobuf = (): unknown[] => {
    try {
      return [decodeTraceRequest(bytes, OTLP_KEEP)];
    } catch (cause) {
      if (cause instanceof ProtobufError) throw cannotRun(`${file} is not an OTLP trace request (byte ${cause.byte})`);
      throw cause;
    }
  };
  if (PROTOBUF_EXTENSIONS.has(extname(file).toLowerCase())) {
    try {
      return protobuf();
    } catch (protobufFailed) {
      const json = jsonDocuments(bytes.toString('utf8'));
      if (json === undefined) throw protobufFailed;
      return json;
    }
  }
  const source = bytes.toString('utf8');
  const json = jsonDocuments(source);
  if (json !== undefined) return json;
  if (looksLikeJson(source)) throw cannotRun(`${file} is not JSON`);
  return protobuf();
};

export interface TraceFiles {
  spans: ObservedSpan[];
  formats: Record<string, string>;
  skipped: SkippedPart[];
  /** One per file read, known by the hash of its contents. */
  sources: ObservedSource[];
  droppedAttributes: number;
  /** Files whose contents were in `known`, or earlier in the list, and so not read again. */
  repeated: string[];
}

/** Reads each file with the reader its contents call for. Only file paths: nothing is fetched. */
export const readTraceFiles = (
  files: readonly string[],
  service?: string,
  options: { known?: ReadonlySet<string>; now?: Date } = {},
): TraceFiles => {
  const spans: ObservedSpan[] = [];
  const formats: Record<string, string> = {};
  const skipped = new Map<string, SkippedPart>();
  const sources: ObservedSource[] = [];
  const repeated: string[] = [];
  const known = new Set(options.known);
  const readAt = (options.now ?? new Date()).toISOString();
  let droppedAttributes = 0;
  for (const file of files) {
    const { bytes, sha256 } = bytesOf(file);
    if (known.has(sha256)) {
      repeated.push(file);
      continue;
    }
    known.add(sha256);
    let read = 0;
    for (const document of documentsOf(file, bytes)) {
      const reader = readerFor(document);
      if (reader === undefined) {
        throw cannotRun(`${file} is neither OTLP (resourceSpans) nor a @nestjs/observe batch (serviceId, snapshots)`);
      }
      formats[file] = reader.name;
      const result = reader.read(document, service);
      spans.push(...result.spans);
      read += result.spans.length;
      droppedAttributes += result.droppedAttributes;
      for (const part of result.skipped) {
        const key = `${part.noun}\u0000${part.why}`;
        const had = skipped.get(key);
        if (had === undefined) skipped.set(key, { ...part });
        else had.count += part.count;
      }
    }
    sources.push({ sha256, format: formats[file] ?? 'empty', spans: read, readAt });
  }
  return { spans, formats, skipped: [...skipped.values()], sources, droppedAttributes, repeated };
};

const LISTED = 20;
/** Entries named under the slowest and the failing most. */
const RANKED = 5;

const skippedSaid = (part: SkippedPart): string => `${part.count} ${part.noun}${part.count === 1 ? '' : 's'} ${part.why}`;

const msSaid = (ms: number | undefined): string => (ms === undefined ? '-' : `${ms}ms`);
const rateSaid = (rate: number | undefined): string =>
  rate === undefined ? '-' : `${Math.round(rate * 1000) / 10}%`;

const rankedLine = (name: string, seen: HitSeen): string =>
  `  ${name}  count ${seen.hits}  p50 ${msSaid(seen.p50)}  p95 ${msSaid(seen.p95)}  max ${msSaid(seen.max)}  errors ${rateSaid(seen.errorRate)}`;

const windowSaid = (run: ObserveRun): string => {
  const { window } = run.observed;
  const span = window.from === null ? 'the window holds nothing' : `window ${window.from} to ${window.to}`;
  const since = window.since === undefined ? '' : ` (since ${window.since})`;
  const repeated = run.repeated.length;
  return `${span}${since}; ${repeated} file${repeated === 1 ? '' : 's'} skipped as already read`;
};

const summary = (run: ObserveRun, labels: ReadonlyMap<string, string>): string[] => {
  const { observed } = run;
  const lines = [`${run.spans} spans read from ${Object.keys(run.formats).length} file(s)`];
  if (run.upgradedFrom !== undefined) {
    lines.push(
      `upgraded the observed file from format ${run.upgradedFrom} to ${OBSERVED_FORMAT_VERSION}: its counts carry over as one hour, without timings`,
    );
  }
  if (run.skipped.length > 0) lines.push(`not read: ${run.skipped.map(skippedSaid).join(', ')}`);
  lines.push(
    `${Object.keys(observed.joins).length} joins seen, ${Object.keys(observed.entries).length} entries hit, ` +
      `${observed.unmatched.length} seen at run time but not found in code, ` +
      `${observed.ambiguous.length} that could be more than one place`,
  );
  for (const row of observed.unmatched.slice(0, LISTED)) {
    lines.push(`  ${row.kind.padEnd(9)} ${row.service ?? '?'}  ${row.name}  (${row.count})`);
  }
  if (observed.unmatched.length > LISTED) lines.push(`  ... ${observed.unmatched.length - LISTED} more`);
  if (observed.ambiguous.length > 0) {
    lines.push('could be more than one place, so counted on none:');
    for (const row of observed.ambiguous.slice(0, LISTED)) {
      const more = row.more === undefined ? '' : ` and ${row.more} more`;
      lines.push(`  ${row.kind.padEnd(9)} ${row.service ?? '?'}  ${row.name}  (${row.count})`);
      lines.push(`    any of ${row.candidates.join(', ')}${more}`);
    }
    if (observed.ambiguous.length > LISTED) lines.push(`  ... ${observed.ambiguous.length - LISTED} more`);
  }
  const entries = Object.entries(observed.entries).filter(([id]) => labels.has(id));
  const name = (id: string): string => labels.get(id) ?? id;
  const slowest = entries
    .filter(([, seen]) => seen.p95 !== undefined)
    .sort(([a, x], [b, y]) => y.p95! - x.p95! || a.localeCompare(b))
    .slice(0, RANKED);
  if (slowest.length > 0) {
    lines.push('slowest entries (p95):');
    for (const [id, seen] of slowest) lines.push(rankedLine(name(id), seen));
  }
  const failing = entries
    .filter(([, seen]) => (seen.errors ?? 0) > 0)
    .sort(([a, x], [b, y]) => y.errors! - x.errors! || (y.errorRate ?? 0) - (x.errorRate ?? 0) || a.localeCompare(b))
    .slice(0, RANKED);
  if (failing.length > 0) {
    lines.push('failing most:');
    for (const [id, seen] of failing) lines.push(rankedLine(name(id), seen));
  }
  lines.push(windowSaid(run));
  lines.push(run.path);
  return lines;
};

/** An entry as the summary names it: its service and its label. */
const labelsOf = (nodes: readonly GraphNode[]): Map<string, string> =>
  new Map(nodes.filter((node) => node.type === 'entry').map((node) => [node.id, `${node.repo} ${node.label}`]));

/** `--since` as given, refused unless it is whole hours or days, or `all`. */
const sinceOf = (since: string | undefined): string | undefined => {
  if (since === undefined) return undefined;
  const said = since.trim();
  if (said === 'all' || parseDuration(said) !== undefined) return said;
  throw cannotRun(`--since takes whole hours, days or weeks (2h, 24h, 7d, 2w) or all, not ${JSON.stringify(since)}`);
};

/**
 * Lays trace files over the built graph and adds them to the observed file
 * beside it: what the file held, plus this run, cut to the window.
 */
export const runObserve = (files: readonly string[], options: ObserveOptions = {}): ObserveRun => {
  if (files.length === 0) throw cannotRun('name at least one trace file');
  const since = sinceOf(options.since);
  const now = options.now ?? new Date();
  const dbPath = dbPathFor(options);
  const before = options.reset === true ? {} : readObservedBeside(dbPath);
  if (before.problem !== undefined) {
    throw cannotRun(`${describeObservedProblem(before.problem)}; run again with --reset to start a new one`);
  }
  const previous = before.observed;
  const read = readTraceFiles(files, options.service, { known: new Set(previous?.sources.map((source) => source.sha256)), now });
  const db = openDbFromOptions(options);
  let run: Observed;
  let labels: Map<string, string>;
  try {
    const nodes = db.allNodes();
    labels = labelsOf(nodes);
    run = matchSpans(indexGraph(nodes, db.allEdges()), read.spans, {
      sources: read.sources,
      droppedAttributes: read.droppedAttributes,
      now,
    });
  } finally {
    db.close();
  }
  const observed = mergeObserved(previous, run, {
    ...(since === undefined ? {} : { since }),
    ...(options.reset === true ? { reset: true } : {}),
    ...(options.samples === false ? { samples: false } : {}),
    now,
  });
  const path = saveObserved(dbPath, observed);
  const result: ObserveRun = {
    path,
    observed,
    spans: read.spans.length,
    formats: read.formats,
    skipped: read.skipped,
    repeated: read.repeated,
    ...(previous !== undefined && previous.observedFormatVersion < OBSERVED_FORMAT_VERSION
      ? { upgradedFrom: previous.observedFormatVersion }
      : {}),
  };
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  if (options.format === 'json') print(JSON.stringify(observed, null, 2));
  else for (const line of summary(result, labels)) print(line);
  return result;
};

export const registerObserve = (program: Command): void => {
  program
    .command('observe')
    .description('add what real traffic did - which joins ran, how long they took, how they answered - from trace files')
    .argument('<file...>', 'OTLP JSON, JSON lines or protobuf, or @nestjs/observe batches, gzipped or not; nothing is sent anywhere')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--service <name>', 'service a span belongs to when the file does not name one')
    .option('--since <dur>', 'keep only the hours inside this window (2h, 24h, 7d), kept for later runs; all stops cutting')
    .option('--reset', 'start the observed file again instead of adding to it')
    .option('--no-samples', 'keep no sample requests, and remove the ones the file holds: then it holds no trace id')
    .option('--format <kind>', 'json or table (default: table)')
    .action((files: string[], options: ObserveOptions) => {
      runObserve(files, options);
    });
};
