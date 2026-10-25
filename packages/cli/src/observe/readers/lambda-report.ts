import { LAMBDA_REPORT_READS } from '../allow-list.js';
import { deployedName } from '../aws.js';
import type { ObservedSpan } from '../span.js';
import { logRecordsOf, recordMs, type LogRecord } from './log-records.js';
import { Dropped, isoOfMs, ms2, NameNeeded, numberOf, Skips, text, withFields, type TraceReader } from './shared.js';

/**
 * Lambda's `REPORT` lines (P108): the one line Lambda writes after every
 * invocation, from a Logs Insights export (JSON or CSV, as `log-records.ts`
 * reads them) or as plain log lines. Each is one run of a function: how long
 * it took, and whether it ended in an error or a timeout. Lines have no
 * parent and no trace, so they give the function's entry, never a join, and
 * no sample (D3).
 *
 * The function is named by the record's log group (`/aws/lambda/<name>`, in
 * `@log` as `<account>:<group>`) or its log stream, else by `--function`; a
 * line that none of them names refuses the file (D2). Of a line only
 * `Duration` and `Status` are read: the request id, the billed duration, the
 * memory figures, the init duration and the X-Ray ids on it are not, and a
 * line that is not a `REPORT` line is not read at all.
 */

const REPORT = /^REPORT RequestId:/;

/** A plain line, as `aws logs tail` prints it too: an optional time and stream before the message. */
const PLAIN_LINE = /^(?:(\d{4}-\d{2}-\d{2}T\S+)\s+(?:\S+\s+)?)?(REPORT RequestId:.*)$/;

/** `Duration: 180.00 ms`, and not `Billed Duration`, `Init Duration` or `Restore Duration`. */
const DURATION = /(?<![A-Za-z] )Duration: (\d+(?:\.\d+)?) ms/;
/** Written only when the run did not succeed. */
const STATUS = /\bStatus: ([A-Za-z]+)/;
const FAILED: ReadonlySet<string> = new Set(['error', 'timeout']);

/** `/aws/lambda/checkout`, or a Lambda@Edge copy of it, `/aws/lambda/us-east-1.checkout`. */
const LOG_GROUP = /^\/aws\/lambda\/(?:[a-z]{2}(?:-[a-z]+)+-\d+\.)?([^/]+)$/;
/** A stream in a log group of the team's own: `2025/10/16/checkout[$LATEST]<id>`. */
const LOG_STREAM = /^\d{4}\/\d{2}\/\d{2}\/([^[/]+)\[/;

/** The function a record is of, from its log group or its stream; never the account `@log` starts with. */
const functionOf = (record: LogRecord): string | undefined => {
  const log = text(record.fields['@log']);
  const group = log === undefined ? undefined : LOG_GROUP.exec(log.slice(log.lastIndexOf(':') + 1));
  const stream = text(record.fields['@logStream']);
  const named = group?.[1] ?? (stream === undefined ? undefined : LOG_STREAM.exec(stream)?.[1]);
  return deployedName('function', named);
};

interface Report {
  message: string;
  ms?: number;
  fn?: string;
  /** Insights' own parse of the duration, when the export has it. */
  duration?: number;
}

/** The REPORT lines a document holds, each with what names its function and its time. */
const reportsOf = (document: unknown, skips: Skips, dropped: Dropped): Report[] | undefined => {
  const records = logRecordsOf(document, LAMBDA_REPORT_READS.record, dropped);
  if (records !== undefined) {
    return records.flatMap((record): Report[] => {
      if (record.message === undefined || !REPORT.test(record.message)) {
        skips.add('line', 'not starting REPORT');
        return [];
      }
      const ms = recordMs(record.timestamp);
      const fn = functionOf(record);
      const duration = numberOf(record.fields['@duration']);
      return [{ message: record.message, ...(ms === undefined ? {} : { ms }), ...(fn === undefined ? {} : { fn }), ...(duration === undefined ? {} : { duration }) }];
    });
  }
  if (typeof document !== 'string') return undefined;
  return document.split(/\r?\n/).flatMap((line): Report[] => {
    if (line.trim() === '') return [];
    const plain = PLAIN_LINE.exec(line.trim());
    if (plain === null) {
      skips.add('line', 'not starting REPORT');
      return [];
    }
    const ms = recordMs(plain[1]);
    return [{ message: plain[2]!, ...(ms === undefined ? {} : { ms }) }];
  });
};

const looksLikeReports = (document: unknown): boolean => {
  const records = logRecordsOf(document, LAMBDA_REPORT_READS.record);
  if (records !== undefined) return records.some((record) => record.message !== undefined && REPORT.test(record.message));
  return typeof document === 'string' && document.split(/\r?\n/, 200).some((line) => PLAIN_LINE.test(line.trim()));
};

export const lambdaReportReader: TraceReader = {
  name: 'lambda-report',
  takes: ['function'],
  sniff: looksLikeReports,
  read: (document, fallbackService, options = {}) => {
    const skips = new Skips();
    const dropped = new Dropped();
    const reports = reportsOf(document, skips, dropped) ?? [];
    const unnamed = reports.filter((report) => report.fn === undefined).length;
    if (unnamed > 0 && options.function === undefined) {
      throw new NameNeeded(`has ${unnamed} REPORT line${unnamed === 1 ? '' : 's'} no log group names the function of`, '--function');
    }
    const part = options.part ?? 0;
    const spans: ObservedSpan[] = reports.map((report, index) => {
      const fn = report.fn ?? options.function!;
      const duration = report.duration ?? numberOf(DURATION.exec(report.message)?.[1]);
      const status = STATUS.exec(report.message)?.[1]?.toLowerCase();
      const id = `report:${part}:${index}`;
      return withFields(
        { traceId: id, spanId: id, kind: 'server' },
        {
          service: fallbackService ?? fn,
          faas: fn,
          at: isoOfMs(report.ms),
          durationMs: duration === undefined ? undefined : ms2(duration),
          error: status !== undefined && FAILED.has(status) ? true : undefined,
          sampleable: false,
        },
      );
    });
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
  },
};
