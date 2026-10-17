import { only } from '../allow-list.js';
import { Dropped, isObject, list, text, type Json } from './shared.js';

/**
 * The shapes a CloudWatch Logs export comes in (P108), each read as records
 * holding only the fields a reader names:
 *
 * - `aws logs filter-log-events` output, `{ events: [{ timestamp, message, ... }] }`;
 * - a Logs Insights result downloaded from the console as JSON, `[{ "@timestamp", "@message", ... }]`,
 *   or one such record per line;
 * - `aws logs get-query-results` output, `{ results: [[{ field, value }, ...], ...] }`;
 * - a Logs Insights result downloaded as CSV, its first row the field names.
 *
 * A record's other fields are counted, never kept. The message is the
 * reader's to parse; it is not held here past the record.
 */

/** A CSV text: rows of fields, by RFC 4180 (quoted fields, `""` for a quote, line breaks inside quotes). */
export const csvRows = (source: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell !== ''));
};

/** The first line of a text, as a CSV header, names `@message`. */
const isInsightsCsv = (source: string): boolean => {
  const end = source.search(/\r?\n/);
  const header = end === -1 ? source : source.slice(0, end);
  return csvRows(header)[0]?.some((cell) => cell.trim() === '@message') ?? false;
};

const isRecord = (value: unknown): boolean => isObject(value) && (typeof value['@message'] === 'string' || typeof value['message'] === 'string');

/** A `get-query-results` row: `[{ field, value }, ...]` as one record. */
const fromFields = (row: unknown): Json =>
  Object.fromEntries(
    list(row).flatMap((cell) =>
      isObject(cell) && typeof cell['field'] === 'string' ? [[cell['field'], cell['value']] as [string, unknown]] : [],
    ),
  );

/** The records an export holds, before any field is chosen; `undefined` when it is not a log export. */
const recordsIn = (document: unknown): Json[] | undefined => {
  if (typeof document === 'string') {
    if (!isInsightsCsv(document)) return undefined;
    const [header, ...rows] = csvRows(document);
    return rows.map((cells) => Object.fromEntries(header!.map((name, at) => [name.trim(), cells[at] ?? ''])));
  }
  if (Array.isArray(document)) return document.length > 0 && document.every(isRecord) ? (document as Json[]) : undefined;
  if (!isObject(document)) return undefined;
  if (isRecord(document) && typeof document['@message'] === 'string') return [document];
  if (Array.isArray(document['events']) && document['events'].length > 0 && document['events'].every(isRecord)) {
    return document['events'] as Json[];
  }
  if (Array.isArray(document['results']) && document['results'].every(Array.isArray)) {
    const rows = document['results'].map(fromFields);
    return rows.length > 0 && rows.every(isRecord) ? rows : undefined;
  }
  return undefined;
};

/** One record of an export, reduced to `fields`; what else it had is counted in `dropped`. */
export interface LogRecord {
  message: string | undefined;
  /** Milliseconds since the epoch, or the text the export wrote, as the record said. */
  timestamp: unknown;
  fields: Json;
}

/** The records of a log export with only `fields` of each, or `undefined` when the document is not one. */
export const logRecordsOf = (document: unknown, fields: readonly string[], dropped?: Dropped): LogRecord[] | undefined =>
  recordsIn(document)?.map((record) => {
    dropped?.outside(record, fields);
    const kept = only(record, fields);
    return { message: text(kept['@message']) ?? text(kept['message']), timestamp: kept['@timestamp'] ?? kept['timestamp'], fields: kept };
  });

/** A record's time: epoch milliseconds, ISO text, or Insights' `2025-10-16 08:30:00.180` (UTC). */
export const recordMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e11 ? value * 1000 : value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const said = value.trim();
  if (/^\d+$/.test(said)) return recordMs(Number(said));
  const insights = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(said);
  const at = Date.parse(insights === null ? said : `${insights[1]}T${insights[2]}Z`);
  return Number.isFinite(at) ? at : undefined;
};
