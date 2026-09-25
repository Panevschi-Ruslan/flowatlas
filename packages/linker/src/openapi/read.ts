/**
 * A service nobody here can read, taken from the document that describes it.
 *
 * The output is an ordinary `RepoGraph`: the same nodes, the same edges and the
 * same registry a repository produces, so everything downstream — the join, the
 * contract check, `dead`, `impact` — works on a declared service without
 * knowing one exists. That is the point of reading a document here rather than
 * teaching each command about a second kind of end.
 *
 * What is deliberately absent: any attempt to check the document against the
 * service it describes. It cannot be done statically, and a tool that pretended
 * otherwise would be doing the thing this one exists not to do. The document is
 * taken at its word, and the word is labelled everywhere it is repeated.
 */
import {
  SCHEMA_VERSION,
  makeEntryId,
  makeHttpEntryKey,
  makeSymbolId,
  normalizePath,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type TypeRegistry,
} from '@flowatlas/core';
import { OPERATION_VERBS, openapiDocumentSchema, operationSchema, type Operation } from './document.js';
import { inlineName, refOf, registerComponents, sealHashes, type ShapeContext } from './shapes.js';

/**
 * How an edge taken from a document is marked.
 *
 * `marker` is the confidence for a fact somebody asserted rather than one the
 * type system proved, and that is exactly what a document is: an assertion, by
 * a party that is usually not in the room, about code nothing here can open. It
 * ranks below `static` wherever two contributions of one edge meet, which is
 * the right way round — if the service is ever added as a repository, what is
 * read wins over what was declared, without anybody having to remember to.
 *
 * The confidence alone does not say a document said it, so every node and edge
 * produced here also carries `declaredBy`, naming the file. That is what lets a
 * report say which end was trusted rather than leaving a reader to infer it
 * from a word that also covers annotations written in a repository's own source.
 */
const DECLARED_CONFIDENCE = 'marker';

/** The key every fact from a document carries, naming the document. */
export const DECLARED_BY = 'declaredBy';

export interface ReadDocumentOptions {
  /** Service name, which becomes the repo half of every id produced. */
  service: string;
  /**
   * The document's path as a reader should see it, relative to the
   * configuration file. It is the `file` of every node here, so `flow` and
   * `impact` point at the document the way they point at a source file.
   */
  documentPath: string;
  /** Fixed timestamp, for reproducible output. */
  generatedAt?: string;
}

export interface ReadDocumentResult {
  graph: RepoGraph;
  /** How many routes the document declared, for the build's one-line summary. */
  routes: number;
}

/**
 * Something about the document made it unusable as a whole.
 *
 * Thrown rather than reported, because a document that is not a document is a
 * configuration mistake: the alternative is a service that silently has no
 * routes, which reads exactly like a service that has none.
 */
export class OpenapiDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenapiDocumentError';
  }
}

/**
 * A name for the operation, which is what a reader will see as the far end.
 *
 * `operationId` when the document gives one, because that is the name the other
 * team uses for it. Otherwise the verb and the path, which is the only other
 * thing anybody could call it and reads the same way a route does.
 */
const operationName = (operation: Operation, verb: string, path: string): string =>
  typeof operation.operationId === 'string' && operation.operationId.trim() !== ''
    ? operation.operationId.trim()
    : `${verb} ${path}`;

/** A name safe to build a registry entry out of, from a name that may be a route. */
const shapeName = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    next === undefined ? '' : next.toUpperCase(),
  );
  return cleaned === '' ? 'Anonymous' : `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
};

/**
 * Which media type of a body or an answer this reads.
 *
 * JSON, and nothing else. The registry describes shapes that cross as JSON, and
 * a multipart upload or a stream of bytes has no field structure to compare —
 * recording one as though it had would put a shape into the check that nothing
 * on either side could disagree about honestly.
 */
const jsonSchemaOf = (content: Record<string, { schema?: unknown }> | undefined): unknown => {
  if (content === undefined) return undefined;
  const json = Object.entries(content).find(([media]) => media.toLowerCase().includes('json'));
  return json?.[1]?.schema;
};

/**
 * The answer worth comparing, out of however many a document lists.
 *
 * The lowest success code, because that is the one the caller's declared return
 * type is about. An error body is a different shape on a different path, and
 * comparing a caller's success type against a `404` payload would report drift
 * on every route that documents its failures well.
 */
const successResponse = (operation: Operation): unknown => {
  const responses = Object.entries(operation.responses ?? {})
    .filter(([code]) => /^2\d\d$/.test(code))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [, response] of responses) {
    const schema = jsonSchemaOf(response.content as Record<string, { schema?: unknown }> | undefined);
    if (schema !== undefined) return schema;
  }
  return undefined;
};

/** The names of the holes in the path, as the document spells them. */
const pathParameters = (operation: Operation): string[] =>
  (operation.parameters ?? [])
    .filter((parameter) => parameter.in === 'path')
    .map((parameter) => parameter.name);

/**
 * Reads one document into the graph of one service.
 *
 * Every route in it becomes an entry point with a handler behind it, exactly as
 * a route read out of a repository does. The handler stands for an operation
 * nobody here can open, so it is named after the operation and located in the
 * document — which is the only file there is to send a reader to.
 */
export const readOpenapiDocument = (
  raw: unknown,
  options: ReadDocumentOptions,
): ReadDocumentResult => {
  if (raw === null || typeof raw !== 'object') {
    throw new OpenapiDocumentError(`${options.documentPath} is not an object`);
  }
  if (typeof (raw as { swagger?: unknown }).swagger === 'string') {
    throw new OpenapiDocumentError(
      `${options.documentPath} is a Swagger 2 document; convert it to OpenAPI 3 first`,
    );
  }
  const parsed = openapiDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OpenapiDocumentError(
      `${options.documentPath} could not be read as an OpenAPI document: ${parsed.error.issues[0]?.message ?? 'unknown reason'}`,
    );
  }
  const document = parsed.data;
  const { service, documentPath } = options;

  const registry: TypeRegistry = {};
  const declaredIn = `${service}#${documentPath}`;
  const context: ShapeContext = { service, declaredIn, registry };
  registerComponents(document.components?.schemas ?? {}, context);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const declared = { [DECLARED_BY]: documentPath };

  for (const [rawPath, item] of Object.entries(document.paths).sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const [key, verb] of Object.entries(OPERATION_VERBS)) {
      const found = (item as Record<string, unknown>)[key];
      if (found === null || typeof found !== 'object') continue;
      const operation = operationSchema.parse(found);
      const path = normalizePath(rawPath);
      const name = operationName(operation, verb, path);
      const entryId = makeEntryId(service, 'http', makeHttpEntryKey(verb, path));
      const handlerId = makeSymbolId(service, documentPath, name);
      const shape = shapeName(name);

      nodes.push({
        id: entryId,
        type: 'entry',
        label: `${verb} ${path}`,
        repo: service,
        file: documentPath,
        kind: 'http',
        meta: {
          method: verb,
          path,
          rawPath,
          adapter: 'openapi',
          ...declared,
          ...(pathParameters(operation).length === 0
            ? {}
            : { pathParams: pathParameters(operation) }),
          ...(operation.summary === undefined ? {} : { summary: operation.summary }),
        },
      });
      nodes.push({
        id: handlerId,
        type: 'method',
        label: name,
        repo: service,
        file: documentPath,
        meta: { ...declared },
      });

      const body = jsonSchemaOf(
        operation.requestBody?.content as Record<string, { schema?: unknown }> | undefined,
      );
      const bodyRef =
        body === undefined ? undefined : refOf(body as never, context, inlineName(shape, 'Body'));
      const answer = successResponse(operation);
      const returns =
        answer === undefined
          ? undefined
          : refOf(answer as never, context, inlineName(shape, 'Response'));

      edges.push({
        from: entryId,
        to: handlerId,
        type: 'handles',
        confidence: DECLARED_CONFIDENCE,
        file: documentPath,
        ...(bodyRef === undefined ? {} : { params: [bodyRef] }),
        ...(returns === undefined ? {} : { returns }),
        meta: { ...declared, ...(bodyRef === undefined ? {} : { body: bodyRef }) },
      });
    }
  }

  sealHashes(registry, declaredIn);

  return {
    routes: nodes.filter((node) => node.type === 'entry').length,
    graph: {
      schemaVersion: SCHEMA_VERSION,
      repo: service,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      nodes,
      edges,
      types: registry,
      unresolved: [],
      meta: {
        ...declared,
        ...(document.info?.version === undefined ? {} : { documentVersion: document.info.version }),
      },
    },
  };
};
