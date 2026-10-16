import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { dbPathFor, openDbFromOptions, type DbOptions } from '../db.js';
import { cannotRun } from '../exit.js';
import { indexGraph, matchSpans, type Observed } from '../observe/match.js';
import { readerFor } from '../observe/readers.js';
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
}

/** A trace file is one JSON document, or one per line as the OTLP file exporter writes. */
const documentsOf = (file: string): unknown[] => {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch (cause) {
    throw cannotRun(`cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
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
): { spans: ObservedSpan[]; formats: Record<string, string> } => {
  const spans: ObservedSpan[] = [];
  const formats: Record<string, string> = {};
  for (const file of files) {
    for (const document of documentsOf(file)) {
      const reader = readerFor(document);
      if (reader === undefined) {
        throw cannotRun(`${file} is neither OTLP/JSON (resourceSpans) nor a @nestjs/observe trace`);
      }
      formats[file] = reader.name;
      spans.push(...reader.read(document, service));
    }
  }
  return { spans, formats };
};

const summary = (run: ObserveRun): string[] => {
  const { observed } = run;
  const lines = [
    `${observed.spans} spans read from ${Object.keys(run.formats).length} file(s)`,
    `${Object.keys(observed.joins).length} joins seen, ${Object.keys(observed.entries).length} entries hit, ` +
      `${observed.unmatched.length} seen at run time but not found in code`,
  ];
  for (const row of observed.unmatched.slice(0, 20)) {
    lines.push(`  ${row.kind.padEnd(9)} ${row.service ?? '?'}  ${row.name}  (${row.count})`);
  }
  if (observed.unmatched.length > 20) lines.push(`  ... ${observed.unmatched.length - 20} more`);
  lines.push(run.path);
  return lines;
};

/** Lays trace files over the built graph and writes `observed.json` beside it. */
export const runObserve = (files: readonly string[], options: ObserveOptions = {}): ObserveRun => {
  if (files.length === 0) throw cannotRun('name at least one trace file');
  const { spans, formats } = readTraceFiles(files, options.service);
  const db = openDbFromOptions(options);
  let observed: Observed;
  try {
    observed = matchSpans(indexGraph(db.allNodes(), db.allEdges()), spans);
  } finally {
    db.close();
  }
  const path = saveObserved(dbPathFor(options), observed);
  const run = { path, observed, formats };
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
