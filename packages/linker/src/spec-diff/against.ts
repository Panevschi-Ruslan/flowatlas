/**
 * A committed API document against the code (P195).
 *
 * P118 writes a service's documents from the graph and `spec diff` compares
 * two revisions of them. A team that writes its document by hand asks the
 * opposite question: does the document still describe the code? The
 * document is read through its format's reader (P19) into a graph of its own,
 * written back through the same writer the code's document is written with -
 * so both sides are in one normal form, `2XX` and `{id}` and components
 * alike - and the two are compared by `diffSpecs`, the document as the base
 * side and the code as the head.
 *
 * Read that way, each kind of the catalogue says one thing: a removal is a
 * promise the code no longer keeps (the document's line is named), an
 * addition something the code answers that the document does not say, and a
 * field change a field the two disagree on. Every operation the document
 * declares is public by being declared, so a broken promise is an error
 * whether or not anything in this project calls it (D2 does not apply: the
 * readers of a committed document are outside the project).
 *
 * A reader takes what the join needs and nothing more: the body, the success
 * answer and the path. The query and header values and the failure statuses
 * the document declares are laid over what it wrote, from the document
 * itself, so the comparison covers them too. Three parts are never compared: a
 * description (prose, and a hand-written one never matches what the writer
 * says), the guards (a document names security schemes, the code names guard
 * classes; neither word is the other's) and a `format` (the reader keeps none,
 * so the code's `date-time` would differ from every document's `string`).
 */
import type { GraphLookup } from '@flowatlas/contracts';
import { lookupOf } from '@flowatlas/contracts';
import { SCHEMA_VERSION, type GraphNode, type ProjectGraph } from '@flowatlas/core';
import { documentReader } from '../document/readers.js';
import { writeSpecs } from '../document/specs.js';
import { UNREAD_KEY, type JsonSchema } from '../document/write-shapes.js';
import type { SpecKind, SpecOperation, SpecOptions, WrittenSpec } from '../document/written.js';
import { diffSpecs } from './diff.js';
import { NO_CALLER_NOTE, SPEC_CHANGE_KINDS, type SpecChange, type SpecChangeKind, type SpecDiffSummary } from './types.js';

/** Version of `spec-against.json`, independent of every other format. */
export const SPEC_AGAINST_FORMAT_VERSION = 1;

/** The file `spec --against` and `contracts` leave beside the graph. */
export const SPEC_AGAINST_FILE = 'spec-against.json';

/** One step down a document: a key, or an index of a list. */
type Step = string | number;

/** A document committed beside the code, as the command line read it. */
export interface CommittedDocument {
  kind: SpecKind;
  /** The service whose code it describes. */
  service: string;
  /**
   * The application of the service it describes, for a service with more
   * than one address space (`orders@admin`); its own one when absent.
   */
  application?: string;
  /** Where it is, as a change places it: inside the service's repository when it is there. */
  file: string;
  /** The document as plain values. */
  raw: unknown;
  /** The line the value at a path is written on, when the text kept one. */
  lineAt?: (path: readonly Step[]) => number | undefined;
}

/** What one document was compared with. */
export interface AgainstDocument {
  service: string;
  kind: SpecKind;
  file: string;
  /** Operations the document declares. */
  declared: number;
  /** Operations the code's document of that kind holds. */
  written: number;
}

/** `spec-against.json`: every committed document against the code, as one list of changes. */
export interface SpecAgainstReport {
  specAgainstFormatVersion: number;
  documents: AgainstDocument[];
  changes: SpecChange[];
  summary: SpecDiffSummary;
}

/** The kinds a committed document is never compared on, and why (the module comment). */
export const AGAINST_NOT_COMPARED: ReadonlySet<SpecChangeKind> = new Set(['description-changed', 'security-added']);

const FIXED = '1970-01-01T00:00:00.000Z';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The value at a JSON pointer inside the document (`#/components/parameters/Page`). */
const pointed = (raw: unknown, ref: string): unknown => {
  if (!ref.startsWith('#/')) return undefined;
  let found: unknown = raw;
  for (const step of ref.slice(2).split('/')) {
    if (!isRecord(found)) return undefined;
    found = found[step.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return found;
};

/** A value with every `$ref` inside it replaced by what it names; bounded, and a cycle is cut to `{}`. */
const inlined = (raw: unknown, value: unknown, depth = 0, seen: readonly string[] = []): unknown => {
  if (Array.isArray(value)) return value.map((each) => inlined(raw, each, depth + 1, seen));
  if (!isRecord(value)) return value;
  const ref = value['$ref'];
  if (typeof ref === 'string') {
    if (depth > 16 || seen.includes(ref)) return {};
    return inlined(raw, pointed(raw, ref), depth + 1, [...seen, ref]);
  }
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, inlined(raw, each, depth + 1, seen)]));
};

/**
 * A value's schema as the reader would have read it: `integer` is `number`,
 * since JSON has one numeric type and the reader says so for every body.
 */
const asRead = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(asRead);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      key,
      key === 'type' ? (each === 'integer' ? 'number' : Array.isArray(each) ? each.map((one) => (one === 'integer' ? 'number' : one)) : each) : asRead(each),
    ]),
  );
};

/** The raw operation behind a declared route, and the path to it. */
interface RawRoute {
  path: Step[];
  operation: Record<string, unknown>;
  /** The values the path item declares for every verb on it. */
  shared: unknown[];
}

const rawRoute = (raw: unknown, node: GraphNode | undefined): RawRoute | undefined => {
  const rawPath = node?.meta?.['rawPath'];
  const verb = node?.meta?.['method'];
  if (typeof rawPath !== 'string' || typeof verb !== 'string') return undefined;
  const item = isRecord(raw) && isRecord(raw['paths']) ? raw['paths'][rawPath] : undefined;
  if (!isRecord(item)) return undefined;
  const word = Object.keys(item).find((key) => key.toLowerCase() === verb.toLowerCase());
  const operation = word === undefined ? undefined : item[word];
  if (word === undefined || !isRecord(operation)) return undefined;
  return { path: ['paths', rawPath, word], operation, shared: Array.isArray(item['parameters']) ? item['parameters'] : [] };
};

/**
 * What the reader leaves out, laid back over the document it wrote: the
 * query and header values (path values the writer has), and the failure
 * statuses, each with its description. Values are inlined, so nothing they
 * name depends on how the writer named a component. An operation's value
 * replaces the path item's of the same name and place, as OpenAPI says.
 */
const overlay = (raw: unknown, written: Record<string, unknown>, declared: RawRoute): void => {
  const own = Array.isArray(declared.operation['parameters']) ? (declared.operation['parameters'] as unknown[]) : [];
  const byPlace = new Map<string, Record<string, unknown>>();
  for (const parameter of [...declared.shared, ...own].map((each) => inlined(raw, each)).filter(isRecord)) {
    if (parameter['in'] !== 'query' && parameter['in'] !== 'header') continue;
    byPlace.set(`${String(parameter['in'])}|${String(parameter['name'])}`, parameter);
  }
  const parameters = [...byPlace.values()];
  if (parameters.length > 0) {
    const kept = ((written['parameters'] as unknown[] | undefined) ?? []).filter(isRecord).filter((parameter) => parameter['in'] === 'path');
    written['parameters'] = [
      ...kept,
      ...parameters.map((parameter) => ({
        name: String(parameter['name']),
        in: parameter['in'],
        required: parameter['required'] === true,
        ...(parameter['schema'] === undefined ? {} : { schema: asRead(parameter['schema']) }),
      })),
    ];
  }
  const responses = isRecord(written['responses']) ? written['responses'] : {};
  const declaredResponses = declared.operation['responses'];
  for (const [status, response] of Object.entries(isRecord(declaredResponses) ? declaredResponses : {})) {
    if (/^2/.test(status) || status === 'default' || Object.hasOwn(responses, status)) continue;
    const said = inlined(raw, response);
    responses[status] = { description: isRecord(said) && typeof said['description'] === 'string' ? said['description'] : '' };
  }
  written['responses'] = responses;
};

/** The operation of a written document a pointer names. */
const operationAt = (document: Record<string, unknown>, pointer: readonly string[]): Record<string, unknown> | undefined => {
  let found: unknown = document;
  for (const step of pointer) found = isRecord(found) ? found[step] : undefined;
  return isRecord(found) ? found : undefined;
};

/** Where an AsyncAPI operation is written: beside the channels (3.x) or inside one (2.x). */
const asyncPath = (raw: unknown, name: string, address: string | undefined): Step[] | undefined => {
  if (!isRecord(raw)) return undefined;
  if (isRecord(raw['operations']) && Object.hasOwn(raw['operations'], name)) return ['operations', name];
  const channels = isRecord(raw['channels']) ? raw['channels'] : {};
  const channel = address === undefined ? undefined : channels[address];
  if (!isRecord(channel)) return undefined;
  const word = ['publish', 'subscribe'].find((each) => isRecord(channel[each]) && ((channel[each] as Record<string, unknown>)['operationId'] === name || `${each} ${address}` === name));
  return word === undefined ? undefined : ['channels', address as string, word];
};

/** The graph a document was read into, as the writer reads one. */
const lookupOfRead = (document: CommittedDocument): { lookup: GraphLookup; node: (id: string) => GraphNode | undefined } => {
  const { graph } = documentReader(document.kind)(document.raw, { service: document.service, documentPath: document.file, generatedAt: FIXED });
  const project: ProjectGraph = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: FIXED,
    services: [],
    nodes: graph.nodes,
    edges: graph.edges,
    types: graph.types,
    unresolved: [],
  };
  const lookup = lookupOf(project);
  return { lookup, node: (id) => lookup.node(id) };
};

/**
 * A committed document written in the code's normal form: the operations it
 * declares, each placed at its own line in the file and public by being
 * declared there. Throws the reader's `DocumentError` for a document that is
 * not one.
 */
export const declaredSpecs = (document: CommittedDocument, options: SpecOptions = {}): WrittenSpec[] => {
  const { lookup, node } = lookupOfRead(document);
  const specs = writeSpecs(lookup, [document.service], { ...options, kind: document.kind });
  const promised = `declared in ${document.file}`;
  return specs.map((spec) => {
    const written = structuredClone(spec.document);
    const operations = spec.operations.map((operation): SpecOperation => {
      let path: Step[] | undefined;
      if (operation.kind === 'http') {
        const found = rawRoute(document.raw, node(operation.node));
        const target = operationAt(written, operation.pointer);
        if (found !== undefined && target !== undefined) overlay(document.raw, target, found);
        path = found?.path;
      } else {
        const method = node(operation.node.replace(/^(?:producer|consumer):/, ''));
        const address = operation.channel?.replace(/^channel:/, '');
        path = method === undefined ? undefined : asyncPath(document.raw, method.label, address);
      }
      const line = path === undefined ? undefined : document.lineAt?.(path);
      const placed: SpecOperation = { ...operation, file: document.file, public: promised, callers: [] };
      if (line === undefined) delete placed.line;
      else placed.line = line;
      return placed;
    });
    // Named as the code's document of the same application is, so the two pair.
    return document.application === undefined
      ? { ...spec, document: written, operations }
      : { ...spec, application: document.application, name: `${spec.service}@${document.application}`, document: written, operations };
  });
};

/** A schema's `format`s taken out, at every depth: a document's reader keeps none, so none can be compared. */
const unformatted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(unformatted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, each]) => !(key === 'format' && typeof each === 'string'))
      .map(([key, each]) => [key, unformatted(each)]),
  );
};

/**
 * The code's document as a committed one can be compared with: the failure
 * statuses it says it assumed or could not read taken out (a document never
 * promises those), and the formats (`date-time`) a reader does not keep.
 */
const comparable = (spec: WrittenSpec): WrittenSpec => {
  const document = unformatted(spec.document) as Record<string, unknown>;
  if (spec.kind !== 'openapi') return { ...spec, document };
  for (const operation of spec.operations) {
    const target = operationAt(document, operation.pointer);
    const responses = isRecord(target?.['responses']) ? (target['responses'] as Record<string, unknown>) : {};
    for (const [status, response] of Object.entries(responses)) {
      if (/^2/.test(status)) continue;
      if (isRecord(response) && (response['x-flowatlas-assumed'] === true || typeof response[UNREAD_KEY] === 'string')) delete responses[status];
    }
  }
  return { ...spec, document };
};

const fieldSaid = (change: SpecChange): string => (change.field === null ? '' : `\`${change.field}\``);

/**
 * What each kind means read as document (base) against code (head), in place
 * of the revision's words `diffSpecs` writes. A lookup, so a kind the
 * catalogue gains is a line here.
 */
const AGAINST_SAID: Readonly<Record<SpecChangeKind, (change: SpecChange) => string>> = {
  'endpoint-removed': () => 'the document declares this route; the code no longer answers it',
  'method-removed': () => 'the document declares this verb on the path; the code answers the path but not this verb',
  'path-param-added': (change) => `the code's path is ${change.head ?? 'another'}, not the one the document declares`,
  'request-property-became-required': (change) => `the code requires ${fieldSaid(change)}, which the document lets a caller leave out`,
  'request-property-added-required': (change) => `the code requires ${fieldSaid(change)}, which the document does not declare`,
  'request-property-type-changed': (change) => `${fieldSaid(change)} is ${change.base ?? 'unknown'} in the document and ${change.head ?? 'unknown'} in the code`,
  'response-property-removed': (change) => `the document promises ${fieldSaid(change)} in the answer; the code does not send it`,
  'response-property-type-changed': (change) => `${fieldSaid(change)} is answered as ${change.head ?? 'unknown'}; the document promises ${change.base ?? 'unknown'}`,
  'response-property-became-optional': (change) => `the document promises ${fieldSaid(change)}; the code may leave it out`,
  'response-status-removed': (change) => `the document's success answer ${change.base ?? ''} is not what the code answers${change.head === null ? '' : ` (${change.head})`}`,
  'channel-removed': () => 'the document says this service publishes here; the code does not',
  'message-property-removed': (change) => `the document promises ${fieldSaid(change)} in the message; the code does not send it`,
  'message-property-type-changed': (change) => `${fieldSaid(change)} is sent as ${change.head ?? 'unknown'}; the document promises ${change.base ?? 'unknown'}`,
  'message-property-became-optional': (change) => `the document promises ${fieldSaid(change)} in the message; the code may leave it out`,
  'request-property-removed': (change) => `the document declares ${fieldSaid(change)}; the code does not read it`,
  'response-status-added': (change) => `the code can fail with ${change.field?.replace(/^status /, '') ?? 'a status'}${change.head === null || change.head === '' ? '' : ` (${change.head})`}, which the document does not declare`,
  'security-added': () => 'guards are not compared with a document',
  'channel-consumer-removed': () => 'the document says this service handles what is published here; the code does not',
  'endpoint-added': () => 'the code answers this; the document does not say it',
  'optional-property-added': (change) => `the code reads or sends ${fieldSaid(change)}, which the document does not declare`,
  'description-changed': () => 'descriptions are not compared with a document',
};

const summaryOf = (changes: readonly SpecChange[]): SpecDiffSummary => {
  const level = (wanted: string): number => changes.filter((change) => change.level === wanted).length;
  return {
    errors: level('error'),
    warnings: level('warning'),
    infos: level('info'),
    breaking: changes.filter((change) => SPEC_CHANGE_KINDS[change.kind].level === 'error').length,
    uncalled: changes.filter((change) => change.note === NO_CALLER_NOTE).length,
  };
};

/** The identity `diffSpecs` pairs operations on, so the code's callers reach the document's side. */
const identity = (operation: SpecOperation): string => (operation.kind === 'http' ? `http|${operation.route ?? operation.key}` : operation.key);

/**
 * Each committed document against the code's document of its kind and
 * service, as one report. `code` is every document written from the graph
 * for the services compared; a document whose service the code wrote none
 * of that kind for is compared with nothing, so everything it declares is a
 * promise not kept.
 */
export const specAgainst = (
  committed: readonly CommittedDocument[],
  code: readonly WrittenSpec[],
  options: SpecOptions & { depth?: number } = {},
): SpecAgainstReport => {
  const documents: AgainstDocument[] = [];
  const changes: SpecChange[] = [];
  for (const document of committed) {
    const declared = declaredSpecs(document, options);
    const theirs = code
      .filter((spec) => spec.service === document.service && spec.kind === document.kind && spec.application === document.application)
      .map(comparable);
    const callers = new Map(theirs.flatMap((spec) => spec.operations.map((operation) => [identity(operation), operation.callers] as const)));
    const report = diffSpecs(declared, theirs, {
      callers: (operation) => callers.get(identity(operation)) ?? [],
      ...(options.depth === undefined ? {} : { depth: options.depth }),
    });
    documents.push({
      service: document.service,
      kind: document.kind,
      file: document.file,
      declared: declared.reduce((sum, spec) => sum + spec.operations.length, 0),
      written: theirs.reduce((sum, spec) => sum + spec.operations.length, 0),
    });
    for (const change of report.changes) {
      if (AGAINST_NOT_COMPARED.has(change.kind)) continue;
      changes.push({ ...change, message: `${change.operation}: ${AGAINST_SAID[change.kind](change)}` });
    }
  }
  return { specAgainstFormatVersion: SPEC_AGAINST_FORMAT_VERSION, documents, changes, summary: summaryOf(changes) };
};
