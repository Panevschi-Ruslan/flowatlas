/**
 * The project as a Structurizr DSL workspace (P119): a C4 container view of
 * the services, their tables (one store per service), their channels (one
 * queue per channel prefix) and the hosts outside the project, and one
 * dynamic view per flow - the request a way in starts, step by step across
 * containers, in call order (D3).
 *
 * Every relationship is a join the graph made (`exportModelOf`), one per
 * (from, to, kind), described by what crosses it (`POST /invoices`,
 * `publishes order.created`, `writes orders`) and collapsed past
 * `maxLabels` with "+N more" (I9). A dynamic view only draws a step whose
 * relationship is in the model, so the DSL never names a relation the
 * container view does not hold (I3). The flows are walked by the caller and
 * handed in as P116 sequences; choosing among them, bounding them and
 * writing them is here, pure, sorted and without a timestamp.
 */
import type { Sequence, SequenceStep } from '../diff/sequence.js';
import type { ExportFile } from './backstage.js';
import { collapseLabels, compareText, exportModelOf, JOIN_KINDS, type ExportGraph, type ExportJoin, type ExportService, type JoinKind } from './joins.js';
import { catalogName, dslIdentifier, nameBook } from './names.js';

export const STRUCTURIZR_FILE = 'workspace.dsl';
/** Labels a relationship lists before it says "+N more". */
export const DEFAULT_MAX_LABELS = 3;
/** Dynamic views written when nobody names the flows. */
export const DEFAULT_EXPORT_FLOWS = 10;

/** One way in, walked by the caller and read as a sequence (P116 `sequenceOf`, service detail). */
export interface ExportFlow {
  entry: string;
  label: string;
  service: string;
  sequence: Sequence;
  truncated?: string;
}

export interface StructurizrOptions {
  services: readonly ExportService[];
  /** The software system's name: the project. */
  project: string;
  /** Only joins touching these services (`--service`). */
  only?: readonly string[];
  includeHeuristic?: boolean;
  maxLabels?: number;
  flows?: readonly ExportFlow[];
  maxFlows?: number;
  /** The flows were named (`--flow`): each is drawn, in the order given, unbounded. */
  asked?: boolean;
}

type RelationKind = JoinKind | 'uses';

export interface StructurizrElement {
  id: string;
  kind: 'person' | 'container' | 'softwareSystem';
  name: string;
  description: string;
  technology?: string;
  tags: string[];
  /** A service's own container: the service; a store: the service whose tables it holds. */
  service?: string;
}

export interface StructurizrRelationship {
  from: string;
  to: string;
  kind: RelationKind;
  description: string;
  technology: string;
  /** Every label behind it, before collapsing. */
  labels: string[];
  /** Labels left out of the description. */
  cut: number;
  /** Drawn only from heuristic joins (`includeHeuristic`). */
  heuristic: boolean;
}

export interface StructurizrStep {
  from: string;
  to: string;
  description: string;
  technology: string;
}

export interface StructurizrView {
  key: string;
  entry: string;
  description: string;
  steps: StructurizrStep[];
}

export interface StructurizrModel {
  workspace: string;
  system: { id: string; name: string };
  elements: StructurizrElement[];
  relationships: StructurizrRelationship[];
  views: StructurizrView[];
}

export interface StructurizrSummary {
  containers: number;
  externals: number;
  relationships: number;
  /** Relationships whose description was collapsed past `maxLabels`. */
  collapsed: number;
  flows: {
    drawn: number;
    /** Flows that crossed containers but were past `maxFlows` (I9). */
    cut: number;
    /** Ways in whose flow never leaves one container: no dynamic view (nothing crosses). */
    nothingCrosses: number;
    /** Ways in that draw exactly the steps of a flow ranked above them: one view for both. */
    repeated: number;
  };
  /** Steps of drawn flows left out because their relationship is not in the model (a heuristic one, a cache). */
  stepsCut: number;
  heuristic: { drawn: number; leftOut: number };
}

export interface StructurizrExport {
  files: ExportFile[];
  model: StructurizrModel;
  summary: StructurizrSummary;
}

const TECHNOLOGY: Record<RelationKind, string> = {
  http: 'HTTP',
  invoke: 'Invoke',
  publish: 'Messaging',
  consume: 'Messaging',
  query: 'SQL',
  external: 'HTTP',
  uses: 'HTTPS',
};
const VERB: Record<RelationKind, string> = { http: '', invoke: 'invokes ', publish: 'publishes ', consume: 'delivers ', query: '', external: '', uses: '' };
const RELATION_ORDER: readonly RelationKind[] = ['uses', ...JOIN_KINDS];

/** `order.created` → `order`; `eventbridge/bus/source/Detail` → `eventbridge/bus/source`; a name with no separator is its own group. */
export const channelGroupOf = (channel: string): string => {
  const cut = Math.max(channel.lastIndexOf('.'), channel.lastIndexOf('/'));
  return cut <= 0 ? channel : channel.slice(0, cut);
};

/** A string in DSL quotes: backslashes and quotes escaped, whitespace one space. */
export const dslString = (text: string): string => `"${text.replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A query step's words as a relationship says them: `write orders` → `writes orders`. */
const queryPhrase = (op: 'read' | 'write' | undefined, table: string): string => `${op === 'read' ? 'reads' : 'writes'} ${table}`;
const stepQueryPhrase = (label: string): string => label.replace(/^write\b/, 'writes').replace(/^read\b/, 'reads');

/** Which joins `--service` keeps: those starting or landing in a chosen service, and both ends of a channel one of them uses. */
const inScope = (joins: readonly ExportJoin[], only: ReadonlySet<string> | undefined): ExportJoin[] => {
  if (only === undefined) return [...joins];
  const channels = new Set(joins.filter((join) => (join.kind === 'publish' || join.kind === 'consume') && only.has(join.from)).map((join) => join.to.id));
  return joins.filter((join) => only.has(join.from) || (join.to.service !== undefined && only.has(join.to.service)) || channels.has(join.to.id));
};

/**
 * The workspace: the model, the container view, one dynamic view per chosen
 * flow and the three shapes, as `workspace.dsl`.
 */
export const exportStructurizr = (graph: ExportGraph, options: StructurizrOptions): StructurizrExport => {
  const maxLabels = options.maxLabels ?? DEFAULT_MAX_LABELS;
  const model = exportModelOf(graph, options.services, { includeHeuristic: options.includeHeuristic === true });
  const only = options.only === undefined || options.only.length === 0 ? undefined : new Set(options.only);
  const joins = inScope(model.joins, only);
  const byName = new Map(model.services.map((service) => [service.name, service]));

  const ids = nameBook(dslIdentifier, '_');
  const systemId = ids('system', options.project);
  const elements = new Map<string, StructurizrElement>();
  const element = (key: string, make: (id: string) => StructurizrElement): string => {
    const held = elements.get(key);
    if (held !== undefined) return held.id;
    const made = make(ids(key, key.slice(key.indexOf(':') + 1)));
    elements.set(key, made);
    return made.id;
  };

  // Every service in scope, in name order, so identifiers are handed out the same way each run.
  const shown = new Set<string>(only === undefined ? model.services.map((service) => service.name) : [...only]);
  for (const join of joins) {
    shown.add(join.from);
    if (join.to.service !== undefined && join.kind !== 'query') shown.add(join.to.service);
  }
  const serviceIdOf = (name: string): string =>
    element(`service:${name}`, (id) => {
      const service = byName.get(name);
      return {
        id,
        kind: 'container',
        name,
        description: service?.catalog?.description ?? (service?.kind === 'website' ? 'A website' : service?.kind === 'function' ? 'Functions' : 'A service'),
        technology: service?.type ?? '',
        tags: [],
        service: name,
      };
    });
  for (const name of [...shown].filter((name) => byName.has(name)).sort(compareText)) serviceIdOf(name);

  // Stores and queues collect their labels before they are written.
  const storeTables = new Map<string, Set<string>>();
  const queueChannels = new Map<string, Set<string>>();
  for (const join of joins) {
    if (join.kind === 'query') {
      const owner = join.to.service ?? join.from;
      const held = storeTables.get(owner) ?? new Set<string>();
      held.add(join.to.label);
      storeTables.set(owner, held);
    }
    if (join.kind === 'publish' || join.kind === 'consume') {
      const group = channelGroupOf(join.to.label);
      const held = queueChannels.get(group) ?? new Set<string>();
      held.add(join.to.label);
      queueChannels.set(group, held);
    }
  }
  let collapsed = 0;
  const storeIdOf = (service: string): string =>
    element(`store:${service}_store`, (id) => {
      const tables = collapseLabels([...(storeTables.get(service) ?? [])], maxLabels);
      return { id, kind: 'container', name: `${service} store`, description: tables.text, technology: '', tags: ['Database'], service };
    });
  const queueIdOf = (group: string): string =>
    element(`queue:${group}_messages`, (id) => {
      const channels = collapseLabels([...(queueChannels.get(group) ?? [])], maxLabels);
      return { id, kind: 'container', name: `${group} messages`, description: channels.text, technology: '', tags: ['Queue'] };
    });
  for (const service of [...storeTables.keys()].sort(compareText)) storeIdOf(service);
  for (const group of [...queueChannels.keys()].sort(compareText)) queueIdOf(group);
  const externalIdOf = (host: string): string =>
    element(`external:${host}`, (id) => ({ id, kind: 'softwareSystem', name: host, description: 'Outside the project; called from the code.', tags: ['External'] }));
  for (const host of [...new Set(joins.filter((join) => join.kind === 'external').map((join) => join.to.label))].sort(compareText)) externalIdOf(host);

  const websites = [...shown].filter((name) => byName.get(name)?.kind === 'website').sort(compareText);
  const userId = websites.length === 0 ? undefined : element('person:user', (id) => ({ id, kind: 'person', name: 'User', description: 'Someone using a website of the project.', tags: [] }));

  // Relationships: one per (from, to, kind), every label behind it.
  const folded = new Map<string, { from: string; to: string; kind: RelationKind; labels: string[]; sure: boolean }>();
  const relate = (from: string, to: string, kind: RelationKind, label: string, heuristic: boolean): void => {
    const key = `${from}\u0000${to}\u0000${kind}`;
    const held = folded.get(key) ?? { from, to, kind, labels: [], sure: false };
    held.labels.push(label);
    if (!heuristic) held.sure = true;
    folded.set(key, held);
  };
  if (userId !== undefined) for (const site of websites) relate(userId, serviceIdOf(site), 'uses', 'Uses', false);
  for (const join of joins) {
    const from = byName.has(join.from) ? serviceIdOf(join.from) : undefined;
    if (from === undefined) continue;
    switch (join.kind) {
      case 'http':
      case 'invoke':
        if (join.to.service !== undefined) relate(from, serviceIdOf(join.to.service), join.kind, join.label, join.heuristic);
        break;
      case 'publish':
        relate(from, queueIdOf(channelGroupOf(join.to.label)), 'publish', join.label, join.heuristic);
        break;
      case 'consume':
        relate(queueIdOf(channelGroupOf(join.to.label)), from, 'consume', join.label, join.heuristic);
        break;
      case 'query':
        relate(from, storeIdOf(join.to.service ?? join.from), 'query', queryPhrase(join.op, join.to.label), join.heuristic);
        break;
      case 'external':
        relate(from, externalIdOf(join.to.label), 'external', join.label, join.heuristic);
        break;
      default:
        break;
    }
  }
  const relationships: StructurizrRelationship[] = [...folded.values()]
    .map((held) => {
      const labels = [...new Set(held.labels)].sort(compareText);
      // A table read and written by one service is said once.
      const merged = held.kind === 'query' ? mergeReadsAndWrites(labels) : labels;
      const said = collapseLabels(merged, maxLabels);
      if (said.cut > 0) collapsed += 1;
      return {
        from: held.from,
        to: held.to,
        kind: held.kind,
        description: held.kind === 'uses' ? 'Uses' : `${VERB[held.kind]}${said.text}`,
        technology: TECHNOLOGY[held.kind],
        labels,
        cut: said.cut,
        heuristic: !held.sure,
      };
    })
    .sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to) || RELATION_ORDER.indexOf(a.kind) - RELATION_ORDER.indexOf(b.kind));
  const related = new Set(relationships.map((relationship) => `${relationship.from}\u0000${relationship.to}\u0000${relationship.kind}`));

  // Flows: each sequence's steps read as relationships of the model.
  const participantOf = (flow: ExportFlow) => {
    const participants = new Map(flow.sequence.participants.map((participant) => [participant.id, participant]));
    return (id: string): string | undefined => {
      const participant = participants.get(id);
      if (participant === undefined) return undefined;
      switch (participant.kind) {
        case 'caller':
          return byName.get(flow.service)?.kind === 'website' ? userId : undefined;
        case 'service':
          return elements.get(`service:${participant.service ?? participant.id}`)?.id;
        case 'table':
          return participant.service === undefined ? undefined : elements.get(`store:${participant.service}_store`)?.id;
        case 'channel':
          return elements.get(`queue:${channelGroupOf(participant.id.slice('channel:'.length))}_messages`)?.id;
        case 'external':
          return elements.get(`external:${participant.label}`)?.id;
        default:
          return undefined;
      }
    };
  };
  const stepRelation = (step: SequenceStep, to: StructurizrElement | undefined): { kind: RelationKind; description: string } | undefined => {
    switch (step.kind) {
      case 'enters':
        return { kind: 'uses', description: step.label };
      case 'http_calls':
      case 'hits':
        return { kind: 'http', description: step.label };
      case 'emits':
        return { kind: 'publish', description: `publishes ${step.label}` };
      case 'consumes':
        return { kind: 'consume', description: `delivers ${step.label}` };
      case 'queries':
        return { kind: 'query', description: stepQueryPhrase(step.label) };
      case 'calls':
      case 'triggers':
        return to?.kind === 'softwareSystem' ? { kind: 'external', description: step.label } : { kind: 'invoke', description: `invokes ${step.label}` };
      default:
        return undefined;
    }
  };
  const byId = new Map([...elements.values()].map((each) => [each.id, each]));
  let stepsCut = 0;
  const drawnFlows = (options.flows ?? []).map((flow) => {
    const place = participantOf(flow);
    const steps: StructurizrStep[] = [];
    let cut = 0;
    for (const step of flow.sequence.steps) {
      const from = place(step.from);
      const to = place(step.to);
      if (from === undefined || to === undefined || from === to) continue;
      const relation = stepRelation(step, byId.get(to));
      const drawn = relation !== undefined && related.has(`${from}\u0000${to}\u0000${relation.kind}`) && (options.includeHeuristic === true || (step.confidence !== 'heuristic' && step.confidence !== 'runtime'));
      if (!drawn || relation === undefined) {
        cut += 1;
        continue;
      }
      steps.push({ from, to, description: relation.description, technology: TECHNOLOGY[relation.kind] });
    }
    const crossed = new Set(steps.flatMap((step) => [step.from, step.to]).filter((id) => byId.get(id)?.service !== undefined && byId.get(id)?.tags.length === 0));
    return { flow, steps, cut, crossed: crossed.size };
  });
  const crossing = drawnFlows.filter((each) => each.steps.length > 0);
  const sorted = options.asked === true ? crossing : [...crossing].sort((a, b) => b.crossed - a.crossed || b.steps.length - a.steps.length || compareText(a.flow.entry, b.flow.entry));
  // Two ways in that draw the same steps (a route and the function behind it) are one view: the first ranked.
  const seenSteps = new Set<string>();
  const ranked = sorted.filter((each) => {
    const key = each.steps.map((step) => `${step.from}>${step.to}:${step.description}`).join('\n');
    if (seenSteps.has(key)) return false;
    seenSteps.add(key);
    return true;
  });
  const maxFlows = options.asked === true ? ranked.length : (options.maxFlows ?? DEFAULT_EXPORT_FLOWS);
  const chosen = ranked.slice(0, maxFlows);
  const keys = nameBook(catalogName, '-');
  const views: StructurizrView[] = chosen.map((each) => {
    stepsCut += each.cut;
    return {
      key: keys(each.flow.entry, `${each.flow.service}-${each.flow.label}`),
      entry: each.flow.entry,
      description: `${each.flow.label} (${each.flow.service})`,
      steps: each.steps,
    };
  });

  const ordered = [...elements.values()];
  const workspace: StructurizrModel = {
    workspace: options.project,
    system: { id: systemId, name: options.project },
    elements: ordered,
    relationships,
    views,
  };
  const containers = ordered.filter((each) => each.kind === 'container');
  return {
    files: [{ path: STRUCTURIZR_FILE, text: renderWorkspace(workspace) }],
    model: workspace,
    summary: {
      containers: containers.length,
      externals: ordered.filter((each) => each.kind === 'softwareSystem').length,
      relationships: relationships.length,
      collapsed,
      flows: { drawn: views.length, cut: ranked.length - chosen.length, nothingCrosses: drawnFlows.length - crossing.length, repeated: sorted.length - ranked.length },
      stepsCut,
      heuristic: { drawn: relationships.filter((relationship) => relationship.heuristic).length, leftOut: model.heuristicLeftOut },
    },
  };
};

/** `reads orders` and `writes orders` of one pair → `reads and writes orders`. */
const mergeReadsAndWrites = (labels: readonly string[]): string[] => {
  const writes = new Set(labels.filter((label) => label.startsWith('writes ')).map((label) => label.slice('writes '.length)));
  const out: string[] = [];
  for (const label of labels) {
    if (label.startsWith('reads ') && writes.has(label.slice('reads '.length))) out.push(`reads and writes ${label.slice('reads '.length)}`);
    else if (label.startsWith('writes ') && labels.includes(`reads ${label.slice('writes '.length)}`)) continue;
    else out.push(label);
  }
  return out.sort(compareText);
};

const elementLine = (each: StructurizrElement): string => {
  const words = [dslString(each.name), dslString(each.description)];
  if (each.kind === 'container') words.push(dslString(each.technology ?? ''));
  if (each.tags.length > 0) words.push(dslString(each.tags.join(',')));
  return `${each.id} = ${each.kind} ${words.join(' ')}`;
};

/** The DSL text: model, views, styles; two spaces a level. */
export const renderWorkspace = (workspace: StructurizrModel): string => {
  const inside = workspace.elements.filter((each) => each.kind === 'container');
  const outside = workspace.elements.filter((each) => each.kind !== 'container');
  const lines = [
    '// Written by `flowatlas export structurizr` from what the code says; nothing here was run.',
    '// Run it again rather than editing: `flowatlas export structurizr --check` fails when this file is out of date.',
    `workspace ${dslString(workspace.workspace)} ${dslString('Containers and flows read from the code by flowatlas.')} {`,
    '  model {',
    ...outside.filter((each) => each.kind === 'person').map((each) => `    ${elementLine(each)}`),
    `    ${workspace.system.id} = softwareSystem ${dslString(workspace.system.name)} {`,
    ...inside.map((each) => `      ${elementLine(each)}`),
    '    }',
    ...outside.filter((each) => each.kind === 'softwareSystem').map((each) => `    ${elementLine(each)}`),
    '',
    ...workspace.relationships.map(
      (relationship) => `    ${relationship.from} -> ${relationship.to} ${dslString(relationship.description)} ${dslString(relationship.technology)}${relationship.heuristic ? ` ${dslString('Heuristic')}` : ''}`,
    ),
    '  }',
    '',
    '  views {',
    `    container ${workspace.system.id} ${dslString('Containers')} {`,
    '      include *',
    '      autolayout lr',
    '    }',
    ...workspace.views.flatMap((view) => [
      '',
      `    dynamic ${workspace.system.id} ${dslString(view.key)} ${dslString(view.description)} {`,
      ...view.steps.map((step) => `      ${step.from} -> ${step.to} ${dslString(step.description)} ${dslString(step.technology)}`),
      '      autolayout lr',
      '    }',
    ]),
    '',
    '    styles {',
    '      element "Database" {',
    '        shape Cylinder',
    '      }',
    '      element "Queue" {',
    '        shape Pipe',
    '      }',
    '      element "External" {',
    '        shape RoundedBox',
    '      }',
    '    }',
    '  }',
    '}',
  ];
  return `${lines.join('\n')}\n`;
};
