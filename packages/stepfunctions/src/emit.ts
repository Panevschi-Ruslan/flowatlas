import { channelOfTarget, DEPLOYED_CHANNELS, SDK_SENDS } from '@flowatlas/aws';
import {
  makeChannelId,
  makeEntryId,
  makeLeafId,
  makeStateId,
  makeTableId,
  makeWorkflowEntryKey,
  REACHES_META,
  STEP_OF_META,
  STEPS_META,
  type GraphEdge,
  type GraphNode,
  type MessageTarget,
  type Unresolved,
} from '@flowatlas/core';
import type { State, StateMachine, Transition } from './definition.js';
import { functionReference, workflowReference } from './references.js';
import type { Position } from './source.js';
import { classifyTask, type ChannelTarget, type Task, type TaskTargetKind } from './tasks.js';
import { NO_TEMPLATE_VALUES, type Reading, type TemplateValues, type UnreadCause } from './values.js';

/**
 * A state machine drawn as a graph: a pure function from a definition to the
 * nodes, edges and rows that say what it does.
 *
 * - The machine is a `workflow` entry, keyed by the name it is deployed under,
 *   that `handles` its `StartAt` state.
 * - Every state is a `function` node of kind `state`, and every transition is a
 *   `calls` edge from one state to the next, saying how control gets there.
 * - A task that invokes a function or starts a workflow names it in
 *   `meta.reaches`; the linker draws that edge, across services, by name.
 * - A task that reads or writes a table is a `db_query` on that table.
 * - A task that sends to a queue, publishes to a topic or puts events on a bus
 *   is a producer onto each channel it names, spelled the way the subscriber a
 *   deployment declares spells it, so the two meet on one node.
 * - Anything that could not be read as written is a row, and no edge.
 *
 * Nothing here reads a file or a builder, so a definition found standing on
 * its own and one built inside a deployment file are drawn by the same code.
 */

/** How the workflow's name was found, which decides how far a join on it can be trusted. */
export type NameSource = 'deployment' | 'file-name';

export interface EmitOptions {
  /** The service that owns the definition: `services[].name`. */
  readonly service: string;
  /** Repo-relative POSIX path of the file the definition is written in. */
  readonly file: string;
  /** The name the workflow is deployed under. */
  readonly name: string;
  /**
   * `deployment` when the file that deploys the workflow says its name.
   * `file-name` when only the definition's own file name says it: that is a
   * convention, so the entry says so, and every join made to it by that name is
   * `heuristic` rather than `static`.
   */
  readonly nameFrom: NameSource;
  /** What a `${...}` placeholder in the definition stands for. */
  readonly resolve?: TemplateValues;
  /**
   * The entry's key, where it is not the name: a workflow whose deployed name
   * was not read is keyed by where it is declared, so nothing joins to it.
   */
  readonly key?: string;
  /** More to say on the entry: what declares the workflow, where its definition came from. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface WorkflowFragment {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly rows: readonly Unresolved[];
}

/** Where a step is, for the rows and leaves it produces. */
interface Site {
  readonly repo: string;
  readonly file: string;
  readonly state: State;
  readonly id: string;
  readonly line: number;
  readonly column: number;
}

/** What one task contributes beside its own node. */
interface Effects {
  /** Recorded on the state, for the linker to join by name. */
  readonly reaches: readonly string[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly rows: readonly Unresolved[];
  /** What the state's `meta.task` says about what the task runs on. */
  readonly task: Readonly<Record<string, unknown>>;
}

const NOTHING: Omit<Effects, 'task'> = { reaches: [], nodes: [], edges: [], rows: [] };

/**
 * The row a target nobody could read becomes, by why it could not be read.
 *
 * Three outcomes, because a reader does three different things about them: an
 * expression the service evaluates is the definition working as designed and
 * nothing to fix; a placeholder nothing filled is a value somebody can supply;
 * a field that is missing or names nothing is a definition to correct.
 *
 * Each row is written out whole, its reason beside its file and line, so the
 * gate that holds every reason to the doctor catalogue can see it (I13).
 */
const UNREAD_ROWS: Readonly<
  Record<UnreadCause, (site: Site, what: string, field: string, reading: Reading) => Unresolved>
> = (() => {
  const dynamic = (site: Site, what: string, field: string, reading: Reading): Unresolved => ({
    file: site.file,
    line: site.line,
    reason: 'workflow-target-dynamic',
    level: 'info',
    message: `${site.state.name} ${what} chosen when the state runs: ${field} is ${reading.written}`,
    hint: 'The definition chooses this at run time, so no edge is drawn for it. Nothing to fix here.',
    symbol: site.id,
    meta: { field, written: reading.written },
  });
  const unreadable = (site: Site, what: string, field: string, reading: Reading): Unresolved => ({
    file: site.file,
    line: site.line,
    reason: 'workflow-target-unreadable',
    message:
      reading.written === ''
        ? `${site.state.name} ${what}, and ${field} does not say which`
        : `${site.state.name} ${what}, and ${field} holds ${reading.written}, which does not name one`,
    hint: `Write ${field} as a name or an ARN the service accepts.`,
    symbol: site.id,
    meta: { field, written: reading.written },
  });
  const template = (site: Site, what: string, field: string, reading: Reading): Unresolved => {
    const variables = reading.read ? [] : (reading.variables ?? []);
    return {
      file: site.file,
      line: site.line,
      reason: 'workflow-template-unbound',
      message: `${site.state.name} ${what} named by ${reading.written}, and nothing here says what ${variables.map((name) => `\${${name}}`).join(', ')} stands for`,
      hint: 'Whatever deploys this definition fills the placeholder in first. Read the definition from the file that deploys it, so its values are known, or write the name in place.',
      symbol: site.id,
      meta: { field, written: reading.written, variables },
    };
  };
  return {
    jsonpath: dynamic,
    jsonata: dynamic,
    intrinsic: dynamic,
    template,
    absent: unreadable,
    'not-text': unreadable,
    'not-a-name': unreadable,
  };
})();

const unreadRow = (site: Site, what: string, field: string, reading: Reading): Unresolved =>
  UNREAD_ROWS[reading.read ? 'not-a-name' : reading.cause](site, what, field, reading);

/** A name that joins by reference when it was read, and a row when it was not. */
const reachedBy = (
  site: Site,
  reading: Reading,
  reference: (name: string) => string,
  what: string,
  field: string,
): Effects =>
  reading.read
    ? { ...NOTHING, reaches: [reference(reading.value)], task: { name: reading.value } }
    : { ...NOTHING, rows: [unreadRow(site, what, field, reading)], task: {} };

const CHANNEL_WORDS: Readonly<Record<MessageTarget['kind'], string>> = {
  queue: 'sends to a queue',
  topic: 'publishes to a topic',
  bus: 'puts events on a bus',
};

const TABLE_WORDS: Readonly<Record<Extract<Task, { kind: 'table' }>['op'], string>> = {
  read: 'reads a table',
  write: 'writes to a table',
  delete: 'deletes from a table',
};

/**
 * Where one target of a sending step goes, as a deployment would name it, or
 * the rows that say why it cannot be named.
 *
 * An event is named by its bus, its source and its detail type together, so
 * each of the three has to be read; any that is not is a row of its own.
 */
const messageTarget = (
  site: Site,
  transport: MessageTarget['kind'],
  target: ChannelTarget,
): { readonly sends: MessageTarget } | { readonly rows: Unresolved[] } => {
  const what = CHANNEL_WORDS[transport];
  if (!target.name.read) return { rows: [unreadRow(site, what, SDK_SENDS[transport].address, target.name)] };
  if (transport !== 'bus') return { sends: { kind: transport, name: target.name.value } };
  const { event } = SDK_SENDS.bus;
  const fields = [
    [event.source, target.source],
    [event.detailType, target.detailType],
  ] as const;
  const rows = fields.flatMap(([field, reading]) =>
    reading === undefined || reading.read ? [] : [unreadRow(site, what, field, reading)],
  );
  const [source, detailType] = fields.map(([, reading]) => (reading?.read === true ? reading.value : undefined));
  if (rows.length > 0 || source === undefined || detailType === undefined) return { rows };
  return { sends: { kind: 'bus', name: target.name.value, fields: { source, 'detail-type': detailType } } };
};

/**
 * A step that sends: one producer at the step, the way a call that sends is one
 * producer in code, with an `emits` edge onto each channel it names carrying the
 * message it is given as written. The channel is spelled by the grammar every
 * reader of these services shares, so a subscriber a deployment declares - a
 * mapping from the queue, a subscription to the topic, a rule on the bus - is
 * drawn onto the same node and the linker joins the two by name.
 */
const channelEffects = (site: Site, target: Extract<Task, { kind: 'channel' }>): Effects => {
  const rows: Unresolved[] = [];
  const sends = new Map<string, Readonly<Record<string, unknown>> | undefined>();
  for (const each of target.targets) {
    const found = messageTarget(site, target.transport, each);
    if ('rows' in found) {
      rows.push(...found.rows);
      continue;
    }
    const channel = channelOfTarget(found.sends);
    if (channel !== undefined && !sends.has(channel)) sends.set(channel, each.payload);
  }
  const task = {
    transport: target.transport,
    targets: target.targets.map((each) => (each.name.read ? each.name.value : null)),
  };
  if (sends.size === 0) return { ...NOTHING, rows, task };

  const { adapter, channelKind, kind } = DEPLOYED_CHANNELS[target.transport];
  const id = makeLeafId('producer', site.repo, site.file, site.line, site.column);
  const located = { file: site.file, line: site.line };
  const producer: GraphNode = {
    id,
    type: 'producer',
    kind,
    label: `${kind} ${[...sends.keys()].join(', ')}`,
    repo: site.repo,
    ...located,
    meta: {
      kind,
      adapter,
      channelVia: 'definition',
      ...(target.call === undefined ? {} : { service: target.call.service, action: target.call.action }),
    },
  };
  return {
    reaches: [],
    nodes: [
      producer,
      ...[...sends.keys()].map(
        (channel): GraphNode => ({
          id: makeChannelId(channel),
          type: 'channel',
          label: channel,
          repo: site.repo,
          ...located,
          meta: { channelKind, adapters: [adapter] },
        }),
      ),
    ],
    edges: [
      { from: site.id, to: id, type: 'calls', confidence: 'static', ...located },
      ...[...sends].map(
        ([channel, payload]): GraphEdge => ({
          from: id,
          to: makeChannelId(channel),
          type: 'emits',
          confidence: 'static',
          ...located,
          ...(payload === undefined ? {} : { meta: { payload } }),
        }),
      ),
    ],
    rows,
    task: { ...task, channels: [...sends.keys()] },
  };
};

/** The `db_query` a task on a table becomes, and the tables it reaches. */
const tableEffects = (site: Site, target: Extract<Task, { kind: 'table' }>): Effects => {
  const id = makeLeafId('db_query', site.repo, site.file, site.line, site.column);
  const read = target.tables.flatMap((reading) => (reading.read ? [reading.value] : []));
  const query: GraphNode = {
    id,
    type: 'db_query',
    label: `${target.op} ${read[0] ?? '?'}`,
    repo: site.repo,
    file: site.file,
    line: site.line,
    meta: {
      op: target.op,
      table: read[0] ?? null,
      tables: read,
      ...(target.call === undefined ? {} : { service: target.call.service, action: target.call.action }),
    },
  };
  const located = { file: site.file, line: site.line };
  return {
    reaches: [],
    nodes: [query, ...read.map((table) => ({ id: makeTableId(site.repo, table), type: 'table' as const, label: table, repo: site.repo }))],
    edges: [
      { from: site.id, to: id, type: 'calls', confidence: 'static', ...located },
      ...read.map((table): GraphEdge => ({ from: id, to: makeTableId(site.repo, table), type: 'queries', confidence: 'static', ...located })),
    ],
    rows: target.tables.flatMap((reading) =>
      reading.read ? [] : [unreadRow(site, TABLE_WORDS[target.op], 'TableName', reading)],
    ),
    task: { op: target.op, tables: read },
  };
};

type TargetEffects = { readonly [K in TaskTargetKind]: (site: Site, target: Extract<Task, { kind: K }>) => Effects };

/**
 * What each kind of task contributes, by kind.
 *
 * One entry per kind the classifiers produce, so a new kind is a type error
 * here until somebody says what it draws.
 */
const TARGET_EFFECTS: TargetEffects = {
  function: (site, target) =>
    reachedBy(
      site,
      target.name,
      functionReference,
      'invokes a function',
      target.call === undefined ? 'Resource' : 'FunctionName',
    ),
  workflow: (site, target) => reachedBy(site, target.name, workflowReference, 'starts a workflow', 'StateMachineArn'),
  table: tableEffects,
  channel: channelEffects,
  service: () => ({ ...NOTHING, task: {} }),
  activity: (site, target) =>
    target.name.read
      ? { ...NOTHING, task: { name: target.name.value } }
      : { ...NOTHING, rows: [unreadRow(site, 'waits for an activity', 'Resource', target.name)], task: {} },
  unknown: (site, target) => ({
    ...NOTHING,
    rows: [unreadRow(site, 'runs a task', 'Resource', target.resource)],
    task: {},
  }),
};

/** The one place a target meets the entry for its kind; the record above is what makes the cast true. */
const effectsOf = (site: Site, task: Task): Effects =>
  (TARGET_EFFECTS[task.kind] as (site: Site, task: Task) => Effects)(site, task);

/**
 * What a task's node says about it, whatever it runs on: its kind, and the
 * integration that runs it where there is one.
 */
const taskSummary = (task: Task): Record<string, unknown> => ({
  kind: task.kind,
  ...(task.call === undefined
    ? {}
    : {
        service: task.call.service,
        action: task.call.action,
        pattern: task.call.pattern,
        ...(task.call.sdk ? { sdk: true } : {}),
      }),
});

/** What the label of a task says it calls, so a tree reads without opening the node. */
const taskWord = (task: Task): string => {
  if (task.call !== undefined) return ` ${task.call.service}:${task.call.action}`;
  return task.kind === 'unknown' ? '' : ` ${task.kind}`;
};

/**
 * Fields of a state kept on its node as written, under the name they get there.
 *
 * What a step is given and what it passes on, so a reader at detail 2 sees it
 * without opening the definition. Expressions are kept as text: nothing here
 * evaluates them.
 */
const KEPT_FIELDS: ReadonlyArray<readonly [field: string, key: string]> = [
  ['Comment', 'comment'],
  ['InputPath', 'inputPath'],
  ['Parameters', 'parameters'],
  ['Parameters.$', 'parameters'],
  ['Arguments', 'arguments'],
  ['ResultSelector', 'resultSelector'],
  ['ResultPath', 'resultPath'],
  ['OutputPath', 'outputPath'],
  ['Output', 'output'],
  ['Assign', 'assign'],
  ['Retry', 'retry'],
];

const keptFields = (state: State): Record<string, unknown> =>
  Object.fromEntries(
    KEPT_FIELDS.filter(([field]) => Object.hasOwn(state.fields, field)).map(([field, key]) => [key, state.fields[field]]),
  );

/** What one transition says about itself on the edge it is part of. */
const describeTransition = (transition: Transition): Record<string, unknown> => ({
  kind: transition.kind,
  ...(transition.rule === undefined ? {} : { rule: transition.rule }),
  ...(transition.errors === undefined ? {} : { errors: transition.errors }),
  ...(transition.branch === undefined ? {} : { branch: transition.branch }),
  ...(transition.field === undefined ? {} : { field: transition.field }),
});

/**
 * One edge per pair of states, however many ways control has between them.
 *
 * The graph keeps one edge per `(from, type, to)`, and a `Choice` whose rule and
 * default both lead to one state is still one step to it. Every way is listed on
 * the edge, in execution order, so none of them is lost to the merge.
 */
const transitionEdges = (
  from: string,
  state: State,
  idOf: (name: string) => string | undefined,
  file: string,
  fallbackLine: number,
): GraphEdge[] => {
  const byTarget = new Map<string, Transition[]>();
  for (const transition of state.transitions) {
    byTarget.set(transition.to, [...(byTarget.get(transition.to) ?? []), transition]);
  }
  return [...byTarget].flatMap(([to, transitions]) => {
    const target = idOf(to);
    if (target === undefined) return [];
    const first = transitions[0] as Transition;
    return [
      {
        from,
        to: target,
        type: 'calls',
        confidence: 'static',
        file,
        line: first.position?.line ?? fallbackLine,
        meta: { order: state.transitions.indexOf(first), transitions: transitions.map(describeTransition) },
      },
    ];
  });
};

/**
 * Draws a state machine.
 *
 * Every state is drawn, reachable or not: a state nothing transitions to is
 * still in the definition, and `dead` is the question that finds it.
 */
export const emitWorkflow = (machine: StateMachine, options: EmitOptions): WorkflowFragment => {
  const { service: repo, file, name, nameFrom } = options;
  const resolve = options.resolve ?? NO_TEMPLATE_VALUES;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const rows: Unresolved[] = [];

  const machineLine = machine.position?.line ?? 1;
  const lineOf = (position: Position | undefined): number => position?.line ?? machineLine;

  // A document that is not a state machine is a row and nothing else: an entry
  // with no steps would read as a workflow that does nothing.
  const refused = machine.problems.find((problem) => problem.kind === 'not-a-state-machine');
  if (refused !== undefined) {
    return {
      nodes: [],
      edges: [],
      rows: [
        {
          file,
          line: lineOf(refused.position),
          reason: 'workflow-definition-unreadable',
          message: `${file} does not hold a state machine: ${refused.message}`,
          hint: 'Nothing in this file was drawn. A definition needs StartAt and States at its top level.',
        },
      ],
    };
  }

  const key = options.key ?? makeWorkflowEntryKey(name);
  const entryId = makeEntryId(repo, 'workflow', key);
  nodes.push({
    id: entryId,
    type: 'entry',
    kind: 'workflow',
    label: `workflow ${name}`,
    repo,
    file,
    line: machineLine,
    meta: {
      key,
      name,
      nameFrom,
      // A name taken from a file name is a convention, and a join on it says so.
      ...(nameFrom === 'file-name' ? { nameConfidence: 'heuristic' } : {}),
      startAt: machine.startAt,
      [STEPS_META]: machine.states.length,
      queryLanguage: machine.queryLanguage,
      ...(machine.comment === undefined ? {} : { comment: machine.comment }),
      ...options.meta,
    },
  });

  if (nameFrom === 'file-name') {
    rows.push({
      file,
      line: machineLine,
      reason: 'workflow-named-by-file',
      level: 'info',
      message: `the workflow in ${file} is named ${name} after its file; nothing here says the name it is deployed under`,
      hint: 'A definition read on its own carries no deployed name, so anything joined to it by that name is drawn as heuristic. Read it from the file that deploys it to make the name certain.',
      symbol: entryId,
    });
  }

  for (const problem of machine.problems) {
    rows.push({
      file,
      line: lineOf(problem.position),
      reason: 'workflow-definition-invalid',
      message: `${name}: ${problem.message}`,
      hint: 'The service refuses a definition like this, so what is drawn is what the file says rather than what runs. Correct the definition.',
      symbol: problem.state === undefined ? entryId : makeStateId(repo, file, name, problem.state),
    });
  }

  const ids = new Map(machine.states.map((state) => [state.name, makeStateId(repo, file, name, state.name)]));
  const idOf = (state: string): string | undefined => ids.get(state);

  const start = idOf(machine.startAt);
  if (start !== undefined) {
    edges.push({
      from: entryId,
      to: start,
      type: 'handles',
      confidence: 'static',
      file,
      line: lineOf(machine.at(['StartAt'])),
    });
  }

  for (const state of machine.states) {
    const id = idOf(state.name) as string;
    const line = lineOf(state.position);
    const site: Site = { repo, file, state, id, line, column: state.position?.column ?? 1 };
    const task = state.type === 'Task' ? classifyTask(state, resolve) : undefined;
    const effects = task === undefined ? undefined : effectsOf(site, task);

    nodes.push({
      id,
      type: 'function',
      kind: 'state',
      label: `${state.name} [${state.type}${task === undefined ? '' : taskWord(task)}]`,
      repo,
      file,
      line,
      meta: {
        [STEP_OF_META]: name,
        stateType: state.type,
        ...(state.scope.length === 0 ? {} : { scope: state.scope }),
        ...(state.end ? { end: true } : {}),
        ...(state.queryLanguage === machine.queryLanguage ? {} : { queryLanguage: state.queryLanguage }),
        ...(task === undefined || effects === undefined ? {} : { task: { ...taskSummary(task), ...effects.task } }),
        ...(effects === undefined || effects.reaches.length === 0 ? {} : { [REACHES_META]: effects.reaches }),
        ...keptFields(state),
      },
    });
    edges.push(...transitionEdges(id, state, idOf, file, line));
    if (effects !== undefined) {
      nodes.push(...effects.nodes);
      edges.push(...effects.edges);
      rows.push(...effects.rows);
    }
  }

  return { nodes, edges, rows };
};
