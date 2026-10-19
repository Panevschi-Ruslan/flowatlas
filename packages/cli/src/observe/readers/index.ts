import { apigwAccessLogReader } from './apigw-access-log.js';
import { harReader } from './har.js';
import { jaegerReader } from './jaeger.js';
import { lambdaReportReader } from './lambda-report.js';
import { nestjsObserveReader } from './nestjs-observe.js';
import { otlpReader } from './otlp.js';
import { sfnHistoryReader } from './sfn-history.js';
import type { ReaderFlag, ReaderOptions, TraceReader } from './shared.js';
import { xrayReader } from './xray.js';
import { zipkinReader } from './zipkin.js';

export { apigwAccessLogReader } from './apigw-access-log.js';
export { fieldsOfAttributes, noAttributes, type Attributes } from './attributes.js';
export { harEntries, harReader, type HarEntry } from './har.js';
export { jaegerReader } from './jaeger.js';
export { lambdaReportReader } from './lambda-report.js';
export { csvRows } from './log-records.js';
export { nestjsObserveReader } from './nestjs-observe.js';
export { OTLP_KEEP, OTLP_LISTS, otlpReader } from './otlp.js';
export { sfnHistoryReader } from './sfn-history.js';
export { xrayReader } from './xray.js';
export { zipkinReader } from './zipkin.js';
export {
  NameNeeded,
  TraceFileError,
  type AccessLogKeys,
  type AccessLogRole,
  type Attached,
  type FrontEndContext,
  type ReadContext,
  type ReaderFlag,
  type ReaderOptions,
  type SkippedPart,
  type SpanBodies,
  type TraceRead,
  type TraceReader,
} from './shared.js';

/**
 * Every format known, tried in order; the first whose sniff says yes reads
 * the file. The trace formats come first, OTLP and @nestjs/observe, then the
 * other tracers' exports and a browser's HAR (P112); the AWS exports (P108)
 * come last, so a document a trace reader reads is never taken for an export.
 */
export const TRACE_READERS: ReadonlyMap<string, TraceReader> = new Map(
  [
    otlpReader,
    nestjsObserveReader,
    zipkinReader,
    jaegerReader,
    harReader,
    xrayReader,
    sfnHistoryReader,
    apigwAccessLogReader,
    lambdaReportReader,
  ].map((reader) => [reader.name, reader]),
);

export const readerFor = (document: unknown, options?: ReaderOptions): TraceReader | undefined =>
  [...TRACE_READERS.values()].find((reader) => reader.sniff(document, options));

/** The formats that take a flag, by flag: what an error about a misplaced one names. */
export const formatsTaking = (flag: ReaderFlag): string[] =>
  [...TRACE_READERS.values()].filter((reader) => reader.takes?.includes(flag) === true).map((reader) => reader.name);
