import { isInnerHost, type Shape } from '@flowatlas/core';
import { HAR_READS, only } from '../allow-list.js';
import { pathOf, type ObservedSpan } from '../span.js';
import {
  Dropped,
  isObject,
  isoOfText,
  msOf,
  shapeOfFormNames,
  shapeOfText,
  Skips,
  text,
  TraceFileError,
  withFields,
  type FrontEndContext,
  type Json,
  type ReadContext,
  type SpanBodies,
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
 * With `--shapes` (P113), and only then, an API call's JSON request body and
 * JSON response content are each parsed, walked for their shape (key names
 * and JSON types, value-like keys folded) and dropped in `requestShape` /
 * `responseShape`; a form's fields give their names only.
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
  /** With `--shapes` (P113): the shape of the JSON body the call sent, or of its form fields' names. */
  request?: Shape;
  /** With `--shapes`: the shape of the JSON content it was answered with. */
  response?: Shape;
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

/** A MIME type without its parameters, lower case. */
const mimeOf = (value: unknown): string | undefined => text(value)?.split(';')[0]?.trim().toLowerCase() || undefined;

/**
 * The shape of what a call sent (P113): its JSON `postData.text`, parsed and
 * dropped here, or the names of its form fields; never a field's value. A
 * body of another type is counted, not read.
 */
const requestShape = (request: Json, skips: Skips, dropped: Dropped, attachment: Attachment): Shape | undefined => {
  const { postData } = only(request, HAR_READS.shapesRequest);
  if (!isObject(postData)) return undefined;
  dropped.outside(postData, HAR_READS.postData);
  const { mimeType, text: inline, params, _file } = only(postData, HAR_READS.postData);
  const body = inline === undefined || inline === '' ? (attachedText(_file, attachment, skips) ?? inline) : inline;
  const mime = mimeOf(mimeType);
  if ((mime !== undefined && JSON_TYPE.test(mime)) || (mime === undefined && typeof body === 'string' && /^\s*[{[]/.test(body))) {
    return shapeOfText(body, undefined, skips);
  }
  if (Array.isArray(params) && params.length > 0) {
    const names = params.flatMap((param) => {
      dropped.outside(param, HAR_READS.param);
      const { name } = only(param, HAR_READS.param);
      return typeof name === 'string' && name !== '' ? [name] : [];
    });
    return names.length === 0 ? undefined : shapeOfFormNames(names);
  }
  if (typeof body === 'string' && body !== '') skips.add('body', 'not JSON');
  return undefined;
};

/** The shape of the JSON content a call was answered with (P113), decoded from base64 when it says so. */
const responseShape = (content: unknown, mime: string | undefined, skips: Skips, attachment: Attachment): Shape | undefined => {
  const { text: inline, encoding, _file } = only(content, HAR_READS.shapesContent);
  if (mime === undefined || !JSON_TYPE.test(mime)) {
    if (((typeof inline === 'string' && inline !== '') || typeof _file === 'string') && mime !== undefined) skips.add('body', 'not JSON');
    return undefined;
  }
  // An attached body is the file's bytes as they came, never base64.
  if (inline === undefined || inline === '') return shapeOfText(attachedText(_file, attachment, skips), undefined, skips);
  return shapeOfText(inline, encoding, skips);
};

/**
 * Whether the HAR holds a body of a call at all: inline, or in a file it
 * attached (P205). Playwright's `content: 'omit'` keeps none.
 */
const holdsBody = (request: Json, content: unknown): boolean => {
  const postData = only(request, HAR_READS.shapesRequest)['postData'];
  const sent = only(postData, HAR_READS.postData);
  const answered = only(content, HAR_READS.shapesContent);
  return [sent['text'], sent['_file'], answered['text'], answered['_file']].some((value) => typeof value === 'string' && value !== '');
};

type Attachment = ReadContext['attachment'];

/** The text of a body a HAR attached in a file of its own (P205), or nothing, counted. */
const attachedText = (name: unknown, attachment: Attachment, skips: Skips): string | undefined => {
  if (typeof name !== 'string' || name === '') return undefined;
  if (attachment === undefined) {
    skips.add('body', 'attached in a file of its own, not looked for');
    return undefined;
  }
  const attached = attachment(name);
  if ('why' in attached) {
    skips.add('body', attached.why);
    return undefined;
  }
  return attached.text;
};

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
interface Walk {
  skips: Skips;
  dropped: Dropped;
  shapes?: boolean;
  attachment?: Attachment;
  /** With `shapes`: the API calls kept, and how many of them the HAR holds a body of. */
  held?: { calls: number; withBody: number };
}

/**
 * Playwright's marks on an entry that was not the page's own call to a
 * server (P205), each read for whether it is there: what is skipped, and why.
 */
const NOT_THE_PAGES: ReadonlyArray<[mark: string, why: string]> = [
  ['_apiRequestRef', 'made by the test through its request API, not by the page'],
  ['_serviceWorkerRef', 'made by a service worker'],
  ['_wasFulfilled', 'answered by the test (route.fulfill), not by a server'],
  ['_wasAborted', 'stopped by the test (route.abort)'],
];

const walkEntries = (
  document: unknown,
  { skips, dropped, shapes = false, attachment, held }: Walk,
  visit: (entry: HarEntry, origin: { origin: string; hostname: string }) => void,
): void => {
  const requestFields = shapes ? [...HAR_READS.request, ...HAR_READS.shapesRequest] : HAR_READS.request;
  const contentFields = shapes ? HAR_READS.shapesContent : HAR_READS.content;
  dropped.outside(document, HAR_READS.document);
  dropped.outside((document as Record<string, unknown>)['log'], HAR_READS.log);
  (entriesOf(document) ?? []).forEach((raw, index) => {
    if (!isObject(raw)) throw new TraceFileError(`HAR entry ${index} is not an object`);
    dropped.outside(raw, HAR_READS.entry);
    const fields = only(raw, HAR_READS.entry);
    const { startedDateTime, time, request, response, _resourceType } = fields;
    if (!isObject(request)) throw new TraceFileError(`HAR entry ${index} has no request`);
    dropped.outside(request, requestFields);
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
    dropped.outside(content, contentFields);
    const mime = mimeOf(only(content, HAR_READS.content)['mimeType']);
    const verb = method.toUpperCase();
    const kept = isApiCall(text(_resourceType)?.toLowerCase(), mime, verb, path);
    if (kept !== true) {
      skips.add('entry', kept);
      return;
    }
    const mark = NOT_THE_PAGES.find(([name]) => fields[name] !== undefined && fields[name] !== false && fields[name] !== null);
    if (mark !== undefined) {
      skips.add('entry', mark[1]);
      return;
    }
    const answered = typeof status === 'number' && Number.isInteger(status) ? status : undefined;
    const entry: HarEntry = { index, method: verb, path };
    if (answered !== undefined && answered >= 100 && answered < 600) entry.status = answered;
    // Status 0 (a browser) or -1 (Playwright): the request was blocked, cancelled or failed; nothing answered.
    if (answered !== undefined && answered <= 0) entry.error = true;
    const durationMs = msOf(time);
    if (durationMs !== undefined) entry.durationMs = durationMs;
    const at = isoOfText(startedDateTime);
    if (at !== undefined) entry.at = at;
    if (shapes) {
      if (held !== undefined) {
        held.calls += 1;
        if (holdsBody(request, content)) held.withBody += 1;
      }
      const sent = requestShape(request, skips, dropped, attachment);
      if (sent !== undefined) entry.request = sent;
      const answer = responseShape(content, mime, skips, attachment);
      if (answer !== undefined) entry.response = answer;
    }
    visit(entry, { origin: parsed.origin, hostname: parsed.hostname.toLowerCase() });
  });
};

/**
 * The API calls a HAR records, method, path, status and time only; with
 * `shapes`, the shapes of their JSON bodies too (P113).
 */
export const harEntries = (document: unknown, options: { shapes?: boolean } = {}): HarEntry[] => {
  const entries: HarEntry[] = [];
  walkEntries(document, { skips: new Skips(), dropped: new Dropped(), shapes: options.shapes === true }, (entry) => entries.push(entry));
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
  const bodies: SpanBodies[] = [];
  let ours = 0;
  const held = { calls: 0, withBody: 0 };
  const walk: Walk = { skips, dropped, shapes: readContext?.shapes === true, held };
  if (readContext?.attachment !== undefined) walk.attachment = readContext.attachment;
  walkEntries(document, walk, (entry, origin) => {
    const id = `har:${source}:${entry.index}`;
    const place = placeOf(origin, frontEnd, context);
    // A third party's bodies are its own business: only a call into the map is read for shapes.
    if (place.thirdParty === undefined && (entry.request !== undefined || entry.response !== undefined)) {
      bodies.push({
        traceId: id,
        spanId: id,
        ...(entry.request === undefined ? {} : { request: entry.request }),
        ...(entry.response === undefined ? {} : { response: entry.response }),
      });
    }
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
  if (held.calls > 0 && held.withBody === 0) {
    notes.push('the HAR holds no bodies (Playwright’s content: \'omit\'), so --shapes read nothing of it: record with content: \'embed\' or \'attach\'');
  }
  return {
    spans,
    skipped: skips.list(),
    droppedAttributes: dropped.count,
    ...(notes.length === 0 ? {} : { notes }),
    ...(readContext?.shapes === true ? { bodies } : {}),
  };
};

export const harReader: TraceReader = {
  name: 'har',
  sniff: (document) => entriesOf(document) !== undefined,
  read,
  carriesBodies: true,
};
