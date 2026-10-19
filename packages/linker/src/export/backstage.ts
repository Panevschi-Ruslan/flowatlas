/**
 * The project as Backstage catalogue entities (P119): one `Component` per
 * service, one `API` per service and kind it provides (D1), a `Resource` per
 * table and per host outside the project, and one `Location` listing every
 * file so a single registration picks them all up.
 *
 * `providesApis`, `consumesApis` and `dependsOn` are the joins the graph made
 * (`exportModelOf`), and nothing else: a request into another service's route
 * consumes that service's OpenAPI API, a delivery off a channel another
 * service publishes consumes the publisher's AsyncAPI API, and a query, a
 * host or a function started by name is a dependency. What the code cannot
 * say - owner, lifecycle, system - comes from `services[].catalog` or is
 * written `unknown` and listed, never invented (I3). Backstage relations hold
 * no attributes, so a relation drawn from a heuristic join is named in an
 * annotation of the entity that holds it (I4).
 *
 * Pure: a graph in, files out as strings, sorted, with no timestamp, so a
 * committed catalogue diffs cleanly and `--check` can compare bytes.
 */
import { CONFIDENCE_RANK, type Confidence } from '@flowatlas/core';
import {
  compareText,
  drawnByDefault,
  exportModelOf,
  publishersOf,
  weakerOf,
  type ExportApi,
  type ExportGraph,
  type ExportJoin,
  type ExportModel,
  type ExportService,
} from './joins.js';
import { catalogName, MAX_CATALOG_NAME, nameBook } from './names.js';
import { yamlDocument, yamlDocuments, type YamlValue } from './yaml.js';

export const BACKSTAGE_API_VERSION = 'backstage.io/v1alpha1';
/** What an owner or lifecycle nobody gave is written as. */
export const CATALOG_UNKNOWN = 'unknown';
/** The file holding the `Location` entity. */
export const BACKSTAGE_LOCATION_FILE = 'catalog-locations.yaml';
/** The file holding every `Resource`. */
export const BACKSTAGE_RESOURCES_FILE = 'resources.yaml';

/** Annotation keys this export writes. */
export const BACKSTAGE_ANNOTATIONS = {
  graphId: 'flowatlas/graph-id',
  confidence: 'flowatlas/confidence',
  heuristicRelations: 'flowatlas/heuristic-relations',
  documents: 'flowatlas/documents',
  writtenBy: 'flowatlas/written-by',
  readBy: 'flowatlas/read-by',
  sourceLocation: 'backstage.io/source-location',
} as const;

/** A document P118 wrote for a service, placed beside the entities (`$text: ./orders.openapi.yaml`). */
export interface BackstageDocument {
  service: string;
  kind: 'openapi' | 'asyncapi';
  /** File name in the export directory. */
  file: string;
  text: string;
}

export interface BackstageOptions {
  services: readonly ExportService[];
  /** Only these services' components and APIs, and the resources they depend on (`--service`). */
  only?: readonly string[];
  includeHeuristic?: boolean;
  /** The documents to point each API at; an API without exactly one gets a minimal inline definition. */
  documents?: readonly BackstageDocument[];
  /** Names the `Location` entity: `flowatlas-<project>`. */
  project?: string;
}

export interface BackstageEntity {
  apiVersion: string;
  kind: 'Component' | 'API' | 'Resource' | 'Location';
  metadata: {
    name: string;
    title?: string;
    description?: string;
    annotations?: Record<string, string>;
  };
  spec: Record<string, YamlValue>;
}

export interface ExportFile {
  /** Relative to the export directory. */
  path: string;
  text: string;
}

export interface BackstageSummary {
  components: number;
  apis: number;
  resources: number;
  /** Services the configuration gives no owner, lifecycle or system for. */
  unset: { owner: string[]; lifecycle: string[]; system: string[] };
  /** Channels a service consumes that nothing in the project publishes: the consumer's `consumesApis` names nothing for them. */
  channelsWithoutPublisher: Array<{ channel: string; consumers: string[] }>;
  /** Tables more than one service writes: one Resource, owned by the first writer by name, both depending on it (D2). */
  sharedTables: Array<{ table: string; writers: string[]; owner: string }>;
  /** Names a catalogue could not hold as written. */
  renamed: Array<{ kind: string; from: string; to: string }>;
  /** APIs written with an inline definition: no single document to point at. */
  inline: string[];
  heuristic: { drawn: number; leftOut: number };
}

export interface BackstageExport {
  files: ExportFile[];
  entities: BackstageEntity[];
  summary: BackstageSummary;
}

const API_SUFFIX: Record<ExportApi['kind'], string> = { openapi: 'openapi', asyncapi: 'asyncapi' };

/** Where a Backstage source location points: `url:` unless the configuration already says how. */
const sourceLocationOf = (url: string): string => (/^(?:url|file):/.test(url) ? url : `url:${url}`);

/** A route path as OpenAPI writes it: `/orders/:param` → `/orders/{param}`. */
const openapiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * The definition of an API flowatlas wrote no single document for: the
 * operations, and nothing claimed about their shapes.
 */
const inlineDefinition = (api: ExportApi): string => {
  const info = { title: api.service, version: 'unversioned', description: 'Operations only, read from the code by flowatlas; no document was written for this API.' };
  if (api.kind === 'openapi') {
    const paths: Record<string, Record<string, YamlValue>> = {};
    for (const operation of api.operations) {
      const space = operation.indexOf(' ');
      const method = space < 0 ? 'post' : operation.slice(0, space).toLowerCase();
      const path = space < 0 ? `/${operation}` : openapiPath(operation.slice(space + 1));
      const held = paths[path] ?? {};
      held[method] = { operationId: operation };
      paths[path] = held;
    }
    const sorted = Object.fromEntries(Object.keys(paths).sort(compareText).map((path) => [path, paths[path] as YamlValue]));
    return yamlDocument({ openapi: '3.1.0', info, paths: sorted });
  }
  const channels: Record<string, YamlValue> = {};
  const operations: Record<string, YamlValue> = {};
  const ids = nameBook((text) => text.replace(/[^A-Za-z0-9_.-]+/g, '_'), '_');
  for (const channel of api.operations) {
    const id = ids(channel, channel);
    channels[id] = { address: channel };
    operations[`send_${id}`] = { action: 'send', channel: { $ref: `#/channels/${id}` } };
  }
  return yamlDocument({ asyncapi: '3.0.0', info, channels, operations });
};

interface Relation {
  ref: string;
  confidence: Confidence;
}

/** Relations to one target, folded: the strongest join behind it wins. */
const relationBook = () => {
  const held = new Map<string, Confidence>();
  return {
    add(ref: string, confidence: Confidence): void {
      const was = held.get(ref);
      if (was === undefined || CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[was]) held.set(ref, confidence);
    },
    list(): Relation[] {
      return [...held.entries()].map(([ref, confidence]) => ({ ref, confidence })).sort((a, b) => compareText(a.ref, b.ref));
    },
  };
};

interface ResourceFacts {
  key: string;
  label: string;
  type: 'database' | 'external-api';
  graphIds: Set<string>;
  writers: Set<string>;
  readers: Set<string>;
  /** Services whose own table it is, for a table nobody writes. */
  holders: Set<string>;
  /** Whether any join to it is drawn by default. */
  sure: boolean;
}

/** Tables by label (one Resource for a table two services write, D2) and hosts by host. */
const resourcesOf = (joins: readonly ExportJoin[]): Map<string, ResourceFacts> => {
  const found = new Map<string, ResourceFacts>();
  for (const join of joins) {
    if (join.kind !== 'query' && join.kind !== 'external') continue;
    const key = join.kind === 'query' ? `table:${join.to.label}` : `external:${join.to.label}`;
    const facts = found.get(key) ?? {
      key,
      label: join.to.label,
      type: join.kind === 'query' ? 'database' : 'external-api',
      graphIds: new Set<string>(),
      writers: new Set<string>(),
      readers: new Set<string>(),
      holders: new Set<string>(),
      sure: false,
    };
    facts.graphIds.add(join.to.id);
    if (join.kind === 'query') {
      (join.op === 'read' ? facts.readers : facts.writers).add(join.from);
      if (join.to.service !== undefined) facts.holders.add(join.to.service);
    }
    if (!join.heuristic) facts.sure = true;
    found.set(key, facts);
  }
  return found;
};

const sortedOf = (values: Iterable<string>): string[] => [...values].sort(compareText);

/**
 * The entities and the files that hold them: `<service>.yaml` (the
 * Component, then its APIs), `resources.yaml`, the documents the APIs point
 * at, and `catalog-locations.yaml`, every list sorted.
 */
export const exportBackstage = (graph: ExportGraph, options: BackstageOptions): BackstageExport => {
  const model: ExportModel = exportModelOf(graph, options.services, { includeHeuristic: options.includeHeuristic === true });
  const only = options.only === undefined || options.only.length === 0 ? undefined : new Set(options.only);
  const chosen = model.services.filter((service) => only === undefined || only.has(service.name));
  const byName = new Map(model.services.map((service) => [service.name, service]));
  const renamed: BackstageSummary['renamed'] = [];

  const componentName = nameBook(catalogName, '-', MAX_CATALOG_NAME);
  const apiName = nameBook(catalogName, '-', MAX_CATALOG_NAME);
  const resourceName = nameBook(catalogName, '-', MAX_CATALOG_NAME);
  for (const service of model.services) {
    const name = componentName(service.name, service.name);
    if (name !== service.name) renamed.push({ kind: 'Component', from: service.name, to: name });
  }
  const apiNameOf = (service: string, kind: ExportApi['kind']): string => apiName(`${service}\u0000${kind}`, `${componentName(service, service)}-${API_SUFFIX[kind]}`);
  const hasApi = new Set(model.apis.map((api) => `${api.service}\u0000${api.kind}`));

  const resources = resourcesOf(model.joins);
  for (const facts of [...resources.values()].sort((a, b) => compareText(a.key, b.key))) {
    const name = resourceName(facts.key, facts.label);
    if (name !== facts.label) renamed.push({ kind: 'Resource', from: facts.label, to: name });
  }
  const resourceRef = (key: string): string => `resource:${resourceName(key, '')}`;

  const ownerOf = (service: string | undefined): string => (service === undefined ? CATALOG_UNKNOWN : (byName.get(service)?.catalog?.owner ?? CATALOG_UNKNOWN));
  const lifecycleOf = (service: string): string => byName.get(service)?.catalog?.lifecycle ?? CATALOG_UNKNOWN;
  const systemOf = (service: string | undefined): string | undefined => (service === undefined ? undefined : byName.get(service)?.catalog?.system);

  const publishers = publishersOf(model.joins);
  const withoutPublisher = new Map<string, Set<string>>();
  const documents = options.documents ?? [];
  const entities: BackstageEntity[] = [];
  const files: ExportFile[] = [];
  const inline: string[] = [];
  let heuristicDrawn = 0;
  const wantedResources = new Set<string>();

  for (const service of chosen) {
    const consumes = relationBook();
    const depends = relationBook();
    for (const join of model.joins) {
      if (join.from !== service.name) continue;
      switch (join.kind) {
        case 'http':
          if (join.to.service !== undefined && hasApi.has(`${join.to.service}\u0000openapi`)) consumes.add(apiNameOf(join.to.service, 'openapi'), join.confidence);
          break;
        case 'consume': {
          const from = (publishers.get(join.to.id) ?? []).filter((publish) => publish.from !== service.name);
          if (from.length === 0 && !(publishers.get(join.to.id) ?? []).some((publish) => publish.from === service.name)) {
            const held = withoutPublisher.get(join.to.label) ?? new Set<string>();
            held.add(service.name);
            withoutPublisher.set(join.to.label, held);
          }
          for (const publish of from) consumes.add(apiNameOf(publish.from, 'asyncapi'), weakerOf(join.confidence, publish.confidence));
          break;
        }
        case 'query':
          depends.add(resourceRef(`table:${join.to.label}`), join.confidence);
          wantedResources.add(`table:${join.to.label}`);
          break;
        case 'external':
          depends.add(resourceRef(`external:${join.to.label}`), join.confidence);
          wantedResources.add(`external:${join.to.label}`);
          break;
        case 'invoke':
          if (join.to.service !== undefined) depends.add(`component:${componentName(join.to.service, join.to.service)}`, join.confidence);
          break;
        default:
          break;
      }
    }

    const consumed = consumes.list();
    const dependsOn = depends.list();
    const heuristic = [...consumed, ...dependsOn].filter((relation) => !drawnByDefault(relation.confidence)).map((relation) => (relation.ref.includes(':') ? relation.ref : `api:${relation.ref}`));
    heuristicDrawn += heuristic.length;
    const provides = model.apis.filter((api) => api.service === service.name);
    const name = componentName(service.name, service.name);
    const catalog = service.catalog ?? {};
    const annotations: Record<string, string> = {};
    if (service.graphId !== undefined) annotations[BACKSTAGE_ANNOTATIONS.graphId] = service.graphId;
    if (heuristic.length > 0) annotations[BACKSTAGE_ANNOTATIONS.heuristicRelations] = sortedOf(heuristic).join(', ');
    if (catalog.sourceUrl !== undefined) annotations[BACKSTAGE_ANNOTATIONS.sourceLocation] = sourceLocationOf(catalog.sourceUrl);

    const component: BackstageEntity = {
      apiVersion: BACKSTAGE_API_VERSION,
      kind: 'Component',
      metadata: {
        name,
        ...(name === service.name ? {} : { title: service.name }),
        ...(catalog.description === undefined ? {} : { description: catalog.description }),
        ...(Object.keys(annotations).length === 0 ? {} : { annotations: sortedRecord(annotations) }),
      },
      spec: {
        type: service.kind,
        lifecycle: lifecycleOf(service.name),
        owner: ownerOf(service.name),
        ...(catalog.system === undefined ? {} : { system: catalog.system }),
        ...(provides.length === 0 ? {} : { providesApis: provides.map((api) => apiNameOf(api.service, api.kind)).sort(compareText) }),
        ...(consumed.length === 0 ? {} : { consumesApis: consumed.map((relation) => relation.ref) }),
        ...(dependsOn.length === 0 ? {} : { dependsOn: dependsOn.map((relation) => relation.ref) }),
      },
    };

    const apis = provides.map((api): BackstageEntity => {
      const own = documents.filter((document) => document.service === api.service && document.kind === api.kind).sort((a, b) => compareText(a.file, b.file));
      const apiEntity = apiNameOf(api.service, api.kind);
      if (own.length !== 1) inline.push(apiEntity);
      const apiAnnotations: Record<string, string> = {};
      if (own.length > 1) apiAnnotations[BACKSTAGE_ANNOTATIONS.documents] = own.map((document) => `./${document.file}`).join(', ');
      return {
        apiVersion: BACKSTAGE_API_VERSION,
        kind: 'API',
        metadata: {
          name: apiEntity,
          description:
            api.kind === 'openapi'
              ? `The routes ${api.service} answers (${api.operations.length}), read from the code by flowatlas.`
              : `The channels ${api.service} publishes (${api.operations.length}), read from the code by flowatlas.`,
          ...(Object.keys(apiAnnotations).length === 0 ? {} : { annotations: apiAnnotations }),
        },
        spec: {
          type: api.kind,
          lifecycle: lifecycleOf(api.service),
          owner: ownerOf(api.service),
          ...(systemOf(api.service) === undefined ? {} : { system: systemOf(api.service) as string }),
          definition: own.length === 1 ? { $text: `./${(own[0] as BackstageDocument).file}` } : inlineDefinition(api),
        },
      };
    });

    entities.push(component, ...apis);
    files.push({ path: `${name}.yaml`, text: yamlDocuments([component, ...apis] as unknown as YamlValue[]) });
    for (const document of documents) {
      if (document.service === service.name && provides.some((api) => api.kind === document.kind)) files.push({ path: document.file, text: document.text });
    }
  }

  const sharedTables: BackstageSummary['sharedTables'] = [];
  const resourceEntities: BackstageEntity[] = [];
  for (const facts of [...resources.values()].sort((a, b) => compareText(resourceName(a.key, ''), resourceName(b.key, '')))) {
    if (!wantedResources.has(facts.key)) continue;
    const writers = sortedOf(facts.writers);
    const owner = writers[0] ?? sortedOf(facts.holders)[0] ?? sortedOf(facts.readers)[0];
    if (writers.length > 1) sharedTables.push({ table: facts.label, writers, owner: owner as string });
    const name = resourceName(facts.key, facts.label);
    const annotations: Record<string, string> = { [BACKSTAGE_ANNOTATIONS.graphId]: sortedOf(facts.graphIds).join(', ') };
    if (!facts.sure) annotations[BACKSTAGE_ANNOTATIONS.confidence] = 'heuristic';
    if (writers.length > 0) annotations[BACKSTAGE_ANNOTATIONS.writtenBy] = writers.join(', ');
    if (facts.readers.size > 0) annotations[BACKSTAGE_ANNOTATIONS.readBy] = sortedOf(facts.readers).join(', ');
    const external = facts.type === 'external-api';
    resourceEntities.push({
      apiVersion: BACKSTAGE_API_VERSION,
      kind: 'Resource',
      metadata: {
        name,
        ...(name === facts.label ? {} : { title: facts.label }),
        description: external ? `${facts.label}, called from the code; outside the project.` : `The table ${facts.label}, as the code queries it.`,
        annotations: sortedRecord(annotations),
      },
      spec: {
        type: facts.type,
        owner: external ? CATALOG_UNKNOWN : ownerOf(owner),
        ...(external || systemOf(owner) === undefined ? {} : { system: systemOf(owner) as string }),
      },
    });
  }
  if (resourceEntities.length > 0) {
    entities.push(...resourceEntities);
    files.push({ path: BACKSTAGE_RESOURCES_FILE, text: yamlDocuments(resourceEntities as unknown as YamlValue[]) });
  }

  files.sort((a, b) => compareText(a.path, b.path));
  const location: BackstageEntity = {
    apiVersion: BACKSTAGE_API_VERSION,
    kind: 'Location',
    metadata: {
      name: catalogName(`flowatlas-${options.project ?? 'project'}`),
      description: 'Every entity flowatlas exported from the code. Written by `flowatlas export backstage`; run it again rather than editing.',
    },
    spec: { targets: files.filter((file) => file.path.endsWith('.yaml') && !documents.some((document) => document.file === file.path)).map((file) => `./${file.path}`) },
  };
  entities.push(location);
  files.push({ path: BACKSTAGE_LOCATION_FILE, text: yamlDocument(location as unknown as YamlValue) });
  files.sort((a, b) => compareText(a.path, b.path));

  const unsetOf = (key: 'owner' | 'lifecycle' | 'system'): string[] => chosen.filter((service) => service.catalog?.[key] === undefined).map((service) => service.name);
  return {
    files,
    entities,
    summary: {
      components: chosen.length,
      apis: entities.filter((entity) => entity.kind === 'API').length,
      resources: resourceEntities.length,
      unset: { owner: unsetOf('owner'), lifecycle: unsetOf('lifecycle'), system: unsetOf('system') },
      channelsWithoutPublisher: [...withoutPublisher.entries()].map(([channel, consumers]) => ({ channel, consumers: sortedOf(consumers) })).sort((a, b) => compareText(a.channel, b.channel)),
      sharedTables,
      renamed,
      inline: inline.sort(compareText),
      heuristic: { drawn: heuristicDrawn, leftOut: model.heuristicLeftOut },
    },
  };
};

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => compareText(a, b)));
}
