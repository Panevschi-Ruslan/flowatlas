import { isInnerHost } from '@flowatlas/core';
import { HAR_READS, only } from '../allow-list.js';
import { pathOf, type ObservedSpan } from '../span.js';
import {
  Dropped,
  isObject,
  isoOfText,
  msOf,
  Skips,
  text,
  TraceFileError,
  withFields,
  type FrontEndContext,
  type ReadContext,
  type TraceReader,
} from './shared.js';

/**
 * A browser's HAR file (P112): the Network tab saved as "Save all as HAR",
 * a record of exactly the calls a front end makes into its API, with their
 * timings and statuses. It also holds the user's cookies, tokens and the body
 * of every request, so this is the strictest reader: each entry is read for
 * six fields by key (`HAR_READS`) and nothing else of it is ever a value held
 * here (D2). The URL's query and fragment are cut before a span exists, its
 * origin is compared with the front end's base URLs and dropped, and no error
 * quotes the file.
 *
 * Each API call kept is one client span of the front end. A HAR has no trace
 * context (D3), so its calls are never joined to a back end's spans from
 * another file: the join from the call site to the route is counted from the
 * call alone, narrowed to the service the origin names.
 */

/** One call a HAR records, as the reader keeps it: no other field (P113 reads these). */
export interface HarEntry {
  /** The entry's index in `log.entries`. */
  index: number;
  /** Upper case. */
  method: string;
  /** The shape of the path, without query or fragment, every value masked (`pathOf`). */
  path: string;
  status?: number;
  /** Status 0: the browser blocked or cancelled the request. A 5xx is said by `status`. */
  error?: true;
  durationMs?: number;
  at?: string;
}

/** The resource types a browser writes for a call a script made; every other one is a file. */
const API_TYPES: ReadonlySet<string> = new Set(['xhr', 'fetch']);

/** The other resource types browsers write, named when skipped; anything else is `other`. */
const FILE_TYPES: ReadonlySet<string> = new Set([
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'eventsource',
  'websocket',
  'manifest',
  'ping',
  'preflight',
  'other',
]);

/** A path that names a file: a script, a style, an image, a font, a page. */
const STATIC = /\.(?:m?js|css|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|html?|mp4|webm|mp3|wav|txt|xml|wasm)$/i;

const JSON_TYPE = /^(?:application|text)\/(?:[\w.+-]+\+)?json$/;

const HTTP_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/** The document's entries, or nothing when it is not a HAR. */
const entriesOf = (document: unknown): unknown[] | undefined => {
  if (!isObject(document) || !isObject(document['log'])) return undefined;
  const log = document['log'];
  return log['version'] !== undefined && Array.isArray(log['entries']) ? log['entries'] : undefined;
};

/** Whether an entry is a call a script made rather than a file, from its type, or else its MIME type and method. */
const isApiCall = (resourceType: string | undefined, mime: string | undefined, method: string, path: string): string | true => {
  if (resourceType !== undefined) {
    if (API_TYPES.has(resourceType)) return true;
    return `of type ${FILE_TYPES.has(resourceType) ? resourceType : 'other'}`;
  }
  if (STATIC.test(path)) return 'of a static file';
  if (mime !== undefined && JSON_TYPE.test(mime)) return true;
  // A write answered with no body (a 204) says no type at all.
  if (mime === undefined && method !== 'GET') return true;
  return 'of another type';
};

/**
 * Each entry of a HAR, read for its fields by key and handed to `visit` with
 * its origin, which `visit` compares and drops; files, and calls not over
 * HTTP, are counted in `skips`. Refuses an entry it cannot read, by index and
 * field only.
 */
const walkEntries = (
  document: unknown,
  { skips, dropped }: { skips: Skips; dropped: Dropped },
  visit: (entry: HarEntry, origin: { origin: string; hostname: string }) => void,
): void => {
  dropped.outside(document, HAR_READS.document);
  dropped.outside((document as Record<string, unknown>)['log'], HAR_READS.log);
  (entriesOf(document) ?? []).forEach((raw, index) => {
    if (!isObject(raw)) throw new TraceFileError(`HAR entry ${index} is not an object`);
    dropped.outside(raw, HAR_READS.entry);
    const { startedDateTime, time, request, response, _resourceType } = only(raw, HAR_READS.entry);
    if (!isObject(request)) throw new TraceFileError(`HAR entry ${index} has no request`);
    dropped.outside(request, HAR_READS.request);
    const { method, url } = only(request, HAR_READS.request);
    if (typeof method !== 'string' || !/^[A-Za-z]+$/.test(method)) throw new TraceFileError(`HAR entry ${index} has no request.method`);
    let parsed: URL;
    try {
      parsed = new URL(typeof url === 'string' ? url : '');
    } catch {
      throw new TraceFileError(`HAR entry ${index} has no absolute request.url`);
    }
    if (!HTTP_SCHEMES.has(parsed.protocol)) {
      skips.add('entry', 'not over HTTP');
      return;
    }
    const path = pathOf(parsed.pathname);
    if (path === undefined) throw new TraceFileError(`HAR entry ${index} has no absolute request.url`);
    dropped.outside(response, HAR_READS.response);
    const { status, content } = only(response, HAR_READS.response);
    dropped.outside(content, HAR_READS.content);
    const mime = text(only(content, HAR_READS.content)['mimeType'])?.split(';')[0]?.trim().toLowerCase() || undefined;
    const verb = method.toUpperCase();
    const kept = isApiCall(text(_resourceType)?.toLowerCase(), mime, verb, path);
    if (kept !== true) {
      skips.add('entry', kept);
      return;
    }
    const answered = typeof status === 'number' && Number.isInteger(status) ? status : undefined;
    const entry: HarEntry = { index, method: verb, path };
    if (answered !== undefined && answered >= 100 && answered < 600) entry.status = answered;
    // Status 0: the browser blocked or cancelled the request; nothing answered.
    if (answered === 0) entry.error = true;
    const durationMs = msOf(time);
    if (durationMs !== undefined) entry.durationMs = durationMs;
    const at = isoOfText(startedDateTime);
    if (at !== undefined) entry.at = at;
    visit(entry, { origin: parsed.origin, hostname: parsed.hostname.toLowerCase() });
  });
};

/** The API calls a HAR records, method, path, status and time only (for P113). */
export const harEntries = (document: unknown): HarEntry[] => {
  const entries: HarEntry[] = [];
  walkEntries(document, { skips: new Skips(), dropped: new Dropped() }, (entry) => entries.push(entry));
  return entries;
};

/** The front end the file was saved from: `--service`, else the map's one front end; refused otherwise. */
const frontEndOf = (fallbackService: string | undefined, context: FrontEndContext | undefined): string => {
  if (fallbackService !== undefined) return fallbackService;
  const frontEnds = context?.frontEnds ?? [];
  if (frontEnds.length === 1) return frontEnds[0]!;
  throw new TraceFileError(
    frontEnds.length === 0
      ? 'a HAR is a front end’s calls, and the map has no front end to place them on: name it with --service'
      : `a HAR is one front end’s calls, and the map has ${frontEnds.length} (${frontEnds.join(', ')}): name the one it was saved from with --service`,
  );
};

/**
 * Where a call went, from its origin: the service a base URL names, the front
 * end's own origin or a dev server on this machine (matched by path among the
 * front end's calls), or a third party, by host only (D4).
 */
const placeOf = (
  { origin, hostname }: { origin: string; hostname: string },
  frontEnd: string,
  context: FrontEndContext | undefined,
): Pick<ObservedSpan, 'peerService' | 'thirdParty'> => {
  const service = context?.serviceAt(origin, frontEnd);
  if (service !== undefined) return service === frontEnd ? {} : { peerService: service };
  return isInnerHost(hostname) ? {} : { thirdParty: hostname };
};

const read = (document: unknown, fallbackService?: string, readContext?: ReadContext) => {
  const skips = new Skips();
  const dropped = new Dropped();
  const context = readContext?.frontEnd?.();
  const frontEnd = frontEndOf(fallbackService, context);
  const source = readContext?.source?.slice(0, 12) ?? 'file';
  const spans: ObservedSpan[] = [];
  let ours = 0;
  walkEntries(document, { skips, dropped }, (entry, origin) => {
    const id = `har:${source}:${entry.index}`;
    const place = placeOf(origin, frontEnd, context);
    if (place.thirdParty === undefined) ours += 1;
    spans.push(
      withFields(
        { traceId: id, spanId: id, kind: 'client' },
        {
          service: frontEnd,
          method: entry.method,
          // A third party's path can hold ids; its host says what a reader needs.
          path: place.thirdParty === undefined ? entry.path : undefined,
          ...place,
          at: entry.at,
          status: entry.status,
          durationMs: entry.durationMs,
          error: entry.error,
          // One span with an id made up for it, no tree under it: never a sample (P108).
          sampleable: false,
        },
      ),
    );
  });
  const notes =
    spans.length > 0 && ours === 0
      ? [
          `no call in the HAR went to an origin a base URL of ${frontEnd} names, so each is counted as a third party by its host: ` +
            'name the API’s host under services[].hosts',
        ]
      : [];
  return { spans, skipped: skips.list(), droppedAttributes: dropped.count, ...(notes.length === 0 ? {} : { notes }) };
};

export const harReader: TraceReader = {
  name: 'har',
  sniff: (document) => entriesOf(document) !== undefined,
  read,
};
