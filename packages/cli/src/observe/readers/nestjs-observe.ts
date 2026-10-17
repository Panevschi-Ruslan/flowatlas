import { NESTJS_OBSERVE_READS, only } from '../allow-list.js';
import { pathOf, type ObservedSpan } from '../span.js';
import { Dropped, isObject, isoOfText, list, msOf, Skips, text, withFields, type Json, type TraceReader } from './shared.js';

// --- @nestjs/observe -------------------------------------------------------

/**
 * A telemetry batch as the SDK posts it, `{ serviceId, snapshots, jobs, ... }`,
 * or a bare array of request snapshots someone exported by hand. A snapshot
 * has its trace id in `ti`, its protocol in `p`, the operation the router
 * matched in `op`, the answer in `a` (`m` method, `sc` status, `ou` original
 * URL) and its span tree in `t`. A tree node is `{ o, c, m, t, ch }`: origin,
 * class, method key, tags, children; `n`, a name, is optional and not read.
 */
const isSnapshot = (value: unknown): boolean => isObject(value) && typeof value['ti'] === 'string';

const isBatch = (document: unknown): document is Json =>
  isObject(document) &&
  Array.isArray(document['snapshots']) &&
  (document['serviceId'] === undefined || typeof document['serviceId'] === 'string');

const isSnapshotArray = (document: unknown): document is unknown[] =>
  Array.isArray(document) && document.length > 0 && document.every(isObject) && document.some(isSnapshot);

/** HTTP is the one protocol whose operation is a route; the others wait for their entry kinds. */
const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(['http', 'https']);

/** The databases the SDK records calls to; `m` is `<command> <collection>`, or the SQL operation. */
const DATABASES: ReadonlySet<string> = new Set(['mongodb', 'pg', 'mysql2']);

const METHOD_AND_PATH = /^([A-Z]+)\s+(\/\S*)$/;
const HTTP_METHOD = /^[A-Z]+$/;

const errorOf = (value: unknown): true | undefined =>
  value === undefined || value === null || value === false ? undefined : true;

/** A node the contract accepts: origin, class and method key, all three said. */
const isNode = (node: Json): boolean =>
  text(node['o']) !== undefined && text(node['c']) !== undefined && text(node['m']) !== undefined;

interface TreeContext {
  traceId: string;
  rootId: string;
  service: string | undefined;
  at: string | undefined;
  spans: ObservedSpan[];
  skips: Skips;
  dropped: Dropped;
}

/** One node of a tree as a span: an outgoing request, a database call, or a method. */
const nodeSpan = (node: Json, base: ObservedSpan, skips: Skips, dropped: Dropped): ObservedSpan | undefined => {
  const className = node['c'] as string;
  const methodKey = node['m'] as string;
  const fields = { durationMs: msOf(node['d']), error: errorOf(node['e']) };
  dropped.outside(node['t'], className === 'http' ? NESTJS_OBSERVE_READS.tags : []);
  if (className === 'http') {
    const tags = only(node['t'], NESTJS_OBSERVE_READS.tags);
    const url = text(tags['http.url']);
    const path = url === undefined ? undefined : pathOf(url);
    // `m` is `<METHOD> <host>`: the method is kept, the host never.
    const word = methodKey.split(/\s+/)[0] ?? '';
    const method = text(tags['http.method'])?.toUpperCase() ?? (HTTP_METHOD.test(word) ? word : undefined);
    if (path === undefined || method === undefined) {
      skips.add('node', 'of class http without a method and a URL');
      return undefined;
    }
    return withFields({ ...base, kind: 'client' }, { method, path, ...fields });
  }
  if (DATABASES.has(className)) {
    const collection = methodKey.split(/\s+/)[1];
    if (collection === undefined || collection === '') {
      skips.add('node', `of class ${className} without a collection`);
      return undefined;
    }
    return withFields({ ...base, kind: 'client' }, { collection, ...fields });
  }
  return withFields({ ...base, kind: 'internal' }, { symbol: `${className}.${methodKey}`, ...fields });
};

const walkTree = (roots: unknown, context: TreeContext): void => {
  let counter = 0;
  const walk = (raw: unknown, parentId: string): void => {
    context.dropped.outside(raw, NESTJS_OBSERVE_READS.node);
    const node = only(raw, NESTJS_OBSERVE_READS.node);
    let under = parentId;
    if (isNode(node)) {
      counter += 1;
      const spanId = `${context.rootId}:${counter}`;
      const base: ObservedSpan = { traceId: context.traceId, spanId, parentId, kind: 'internal' };
      if (context.service !== undefined) base.service = context.service;
      if (context.at !== undefined) base.at = context.at;
      const span = nodeSpan(node, base, context.skips, context.dropped);
      if (span !== undefined) {
        context.spans.push(span);
        under = spanId;
      }
    } else {
      context.skips.add('node', 'without o, c and m');
    }
    for (const child of list(node['ch'])) walk(child, under);
  };
  // The contract sends an array; one node on its own is read too.
  for (const root of Array.isArray(roots) ? roots : isObject(roots) ? [roots] : []) walk(root, context.rootId);
};

interface BatchContext {
  service: string | undefined;
  skips: Skips;
  dropped: Dropped;
}

const snapshotSpans = (raw: unknown, index: string, { service, skips, dropped }: BatchContext): ObservedSpan[] => {
  dropped.outside(raw, NESTJS_OBSERVE_READS.snapshot);
  const snapshot = only(raw, NESTJS_OBSERVE_READS.snapshot);
  const traceId = text(snapshot['ti']);
  if (traceId === undefined) {
    skips.add('snapshot', 'without a trace id');
    return [];
  }
  dropped.outside(snapshot['a'], NESTJS_OBSERVE_READS.answer);
  const answer = only(snapshot['a'], NESTJS_OBSERVE_READS.answer);
  const protocol = text(snapshot['p'])?.toLowerCase();
  // A hand export may leave the protocol out; a method in the answer still says HTTP.
  const http = protocol === undefined ? text(answer['m']) !== undefined : HTTP_PROTOCOLS.has(protocol);
  if (!http) {
    skips.add('snapshot', `of protocol ${protocol ?? '(none)'}`);
    return [];
  }
  const operation = text(snapshot['op']);
  const paired = operation === undefined ? null : METHOD_AND_PATH.exec(operation);
  const url = text(answer['ou']);
  const route = paired?.[2] ?? (operation?.startsWith('/') ? operation : undefined);
  const path = url === undefined ? undefined : pathOf(url);
  if (route === undefined && path === undefined) skips.add('snapshot', 'without a route or a URL');
  // `ct`, the time the request came in, trusted only once `Date.parse` does.
  const at = isoOfText(snapshot['ct']);
  const rootId = `${traceId}:${index}`;
  const root = withFields(
    { traceId, spanId: rootId, kind: 'server' },
    {
      service,
      method: text(answer['m'])?.toUpperCase() ?? paired?.[1],
      route,
      path,
      at,
      status: Number.isInteger(answer['sc']) ? (answer['sc'] as number) : undefined,
      durationMs: msOf(snapshot['d']),
      error: errorOf(snapshot['e']),
    },
  );
  const spans: ObservedSpan[] = [root];
  walkTree(snapshot['t'], { traceId, rootId, service, at, spans, skips, dropped });
  return spans;
};

/** A job is read for its span tree only: its own entry kind is not mapped yet. */
const jobSpans = (raw: unknown, index: string, { service, skips, dropped }: BatchContext): ObservedSpan[] => {
  dropped.outside(raw, NESTJS_OBSERVE_READS.job);
  const job = only(raw, NESTJS_OBSERVE_READS.job);
  if (!Array.isArray(job['t']) && !isObject(job['t'])) {
    skips.add('job', 'without a span tree');
    return [];
  }
  const traceId = text(job['ti']) ?? `job:${index}`;
  const spans: ObservedSpan[] = [];
  walkTree(job['t'], { traceId, rootId: `${traceId}:job:${index}`, service, at: isoOfText(job['ct']), spans, skips, dropped });
  return spans;
};

/**
 * A saved series of batch posts, `{ batches: [batch, ...] }` (P105): read as
 * the batches one after another.
 */
const isBatchSeries = (document: unknown): document is Json =>
  isObject(document) && Array.isArray(document['batches']) && document['batches'].length > 0 && document['batches'].every(isBatch);

/** The batches a document holds: a series, one batch, or a bare array of snapshots as one. */
const batchesOf = (document: unknown, dropped: Dropped): Json[] => {
  if (isBatchSeries(document)) {
    dropped.outside(document, ['batches']);
    return (document['batches'] as Json[]).map((batch) => {
      dropped.outside(batch, NESTJS_OBSERVE_READS.batch);
      return only(batch, NESTJS_OBSERVE_READS.batch);
    });
  }
  if (isBatch(document)) {
    dropped.outside(document, NESTJS_OBSERVE_READS.batch);
    return [only(document, NESTJS_OBSERVE_READS.batch)];
  }
  return [{ snapshots: document }];
};

export const nestjsObserveReader: TraceReader = {
  name: 'nestjs-observe',
  sniff: (document) => isBatchSeries(document) || isBatch(document) || isSnapshotArray(document),
  read: (document, fallbackService, options) => {
    const skips = new Skips();
    const dropped = new Dropped();
    // A document after the first of a file, or a post after the first a listener took (P109), says which,
    // so two posts' jobs, which have no trace id of their own, stay two traces.
    const part = options?.part === undefined || options.part === 0 ? '' : `${options.part}/`;
    const spans = batchesOf(document, dropped).flatMap((batch, at) => {
      const context = { service: text(batch['serviceId']) ?? fallbackService, skips, dropped };
      // The first batch's spans keep the ids they always had; a later batch's say which batch.
      const key = (index: number): string => `${part}${at === 0 ? String(index) : `${at}.${index}`}`;
      return [
        ...list(batch['snapshots']).flatMap((snapshot, index) => snapshotSpans(snapshot, key(index), context)),
        ...list(batch['jobs']).flatMap((job, index) => jobSpans(job, key(index), context)),
      ];
    });
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
  },
};
