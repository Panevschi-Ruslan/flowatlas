import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Command } from 'commander';
import { dbPathFor, openDbFromOptions, type DbOptions } from '../db.js';
import { cannotRun } from '../exit.js';
import { indexGraph, matchSpans, type Observed } from '../observe/match.js';
import { readerFor, type SkippedPart } from '../observe/readers.js';
import type { ObservedSpan } from '../observe/span.js';
import { saveObserved } from '../observe/store.js';

export interface ObserveOptions extends DbOptions {
  /** Service a span belongs to when the file does not say. */
  service?: string;
  format?: string;
  print?: (message: string) => void;
}

export interface ObserveRun {
  path: string;
  observed: Observed;
  /** Format read, by file. */
  formats: Record<string, string>;
  /** What the readers saw and did not read, summed over the files. */
  skipped: SkippedPart[];
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** gzip's magic number: a captured POST body from the SDK is read as it is. */
const isGzip = (bytes: Buffer): boolean => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/** A trace file is one JSON document, or one per line as the OTLP file exporter writes; either may be gzipped. */
const documentsOf = (file: string): unknown[] => {
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
  const source = bytes.toString('utf8');
  try {
    return [JSON.parse(source)];
  } catch {
    try {
      return source
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as unknown);
    } catch {
      throw cannotRun(`${file} is not JSON`);
    }
  }
};

/** Reads each file with the reader its contents call for. Only file paths: nothing is fetched. */
export const readTraceFiles = (
  files: readonly string[],
  service?: string,
): { spans: ObservedSpan[]; formats: Record<string, string>; skipped: SkippedPart[] } => {
  const spans: ObservedSpan[] = [];
  const formats: Record<string, string> = {};
  const skipped = new Map<string, SkippedPart>();
  for (const file of files) {
    for (const document of documentsOf(file)) {
      const reader = readerFor(document);
      if (reader === undefined) {
        throw cannotRun(`${file} is neither OTLP/JSON (resourceSpans) nor a @nestjs/observe batch (serviceId, snapshots)`);
      }
      formats[file] = reader.name;
      const read = reader.read(document, service);
      spans.push(...read.spans);
      for (const part of read.skipped) {
        const key = `${part.noun}\u0000${part.why}`;
        const had = skipped.get(key);
        if (had === undefined) skipped.set(key, { ...part });
        else had.count += part.count;
      }
    }
  }
  return { spans, formats, skipped: [...skipped.values()] };
};

const LISTED = 20;

const skippedSaid = (part: SkippedPart): string => `${part.count} ${part.noun}${part.count === 1 ? '' : 's'} ${part.why}`;

const summary = (run: ObserveRun): string[] => {
  const { observed } = run;
  const lines = [`${observed.spans} spans read from ${Object.keys(run.formats).length} file(s)`];
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
  lines.push(run.path);
  return lines;
};

/** Lays trace files over the built graph and writes the observed file beside it. */
export const runObserve = (files: readonly string[], options: ObserveOptions = {}): ObserveRun => {
  if (files.length === 0) throw cannotRun('name at least one trace file');
  const { spans, formats, skipped } = readTraceFiles(files, options.service);
  const db = openDbFromOptions(options);
  let observed: Observed;
  try {
    observed = matchSpans(indexGraph(db.allNodes(), db.allEdges()), spans);
  } finally {
    db.close();
  }
  const path = saveObserved(dbPathFor(options), observed);
  const run = { path, observed, formats, skipped };
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  if (options.format === 'json') print(JSON.stringify(observed, null, 2));
  else for (const line of summary(run)) print(line);
  return run;
};

export const registerObserve = (program: Command): void => {
  program
    .command('observe')
    .description('mark which joins real traffic went through, from OTLP/JSON or @nestjs/observe trace files')
    .argument('<file...>', 'trace files to read; nothing is sent anywhere')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--service <name>', 'service a span belongs to when the file does not name one')
    .option('--format <kind>', 'json or table (default: table)')
    .action((files: string[], options: ObserveOptions) => {
      runObserve(files, options);
    });
};
