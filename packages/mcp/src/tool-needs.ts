/**
 * What each tool needs before it can answer (P201): the one table the server
 * decides its tool list by.
 *
 * Tools are not per framework but per capability. A project with no observed
 * file has nothing for the run-time tools to say, one with no rules nothing
 * for `check_rules`, one whose graph holds no channel nothing for
 * `who_emits`; listing them costs every session the context their schemas
 * take, to answer an error. Every tool the server registers has exactly one
 * row here, and the server refuses to start otherwise.
 */

/** Where a need is read from. */
export type NeedSource = 'nothing' | 'graph' | 'observed file' | 'output directory' | 'configuration' | 'server options';

/** What the server knows when it decides the list, read where each need says. */
export interface ToolFacts {
  /** The graph's held types, when a graph opened; undefined before any build (or a stale one). */
  graph?: {
    nodes: ReadonlySet<string>;
    entryKinds: ReadonlySet<string>;
    edges: ReadonlySet<string>;
    /** How many types the registry holds. */
    types: number;
  };
  /** An observed file readable beside the database. */
  observed: boolean;
  /** A `diff.json` or a `check.<env>.json` beside the database. */
  changes: boolean;
  /** The configuration holds at least one architecture rule. */
  rules: boolean;
  /** A configuration was given, so each service's directory is known. */
  sources: boolean;
  /** The server was handed the pattern tester. */
  tester: boolean;
}

interface NeedRow {
  from: NeedSource;
  holds: (facts: ToolFacts) => boolean;
  /** What is missing, said when a tool is called while hidden. */
  missing: string;
  /** When the tool appears, as `start_here` says it. */
  appears: string;
}

/** The edges one service's request or message reaches another by, which `check_contract` compares. */
const CROSSING_EDGES: readonly string[] = ['http_calls', 'hits', 'emits'];

const withGraph = (facts: ToolFacts, holds: (graph: NonNullable<ToolFacts['graph']>) => boolean): boolean =>
  facts.graph !== undefined && holds(facts.graph);

/**
 * Every need, how it is read and what it takes. A need other than `always`
 * and `tester` holds only once a graph is there: every tool it gates answers
 * over the graph, and before one is built answers only "run flowatlas build",
 * which the always-listed tools already say.
 */
export const NEEDS = {
  always: { from: 'nothing', holds: () => true, missing: '', appears: '' },
  observed: {
    from: 'observed file',
    holds: (facts) => facts.graph !== undefined && facts.observed,
    missing: 'nothing was observed beside this graph',
    appears: 'after flowatlas observe',
  },
  rules: {
    from: 'configuration',
    holds: (facts) => facts.graph !== undefined && facts.rules,
    missing: 'no rules are configured',
    appears: 'after rules[] in flowatlas.config.json',
  },
  changes: {
    from: 'output directory',
    holds: (facts) => facts.graph !== undefined && facts.changes,
    missing: 'no diff.json or check.<env>.json is beside this graph',
    appears: 'after flowatlas diff or check --env',
  },
  channels: {
    from: 'graph',
    holds: (facts) => withGraph(facts, (graph) => graph.nodes.has('channel')),
    missing: 'the graph holds no channel',
    appears: 'once a build reads a channel',
  },
  types: {
    from: 'graph',
    holds: (facts) => withGraph(facts, (graph) => graph.types > 0),
    missing: 'the graph holds no type',
    appears: 'once a build reads a type',
  },
  crossings: {
    from: 'graph',
    holds: (facts) => withGraph(facts, (graph) => CROSSING_EDGES.some((type) => graph.edges.has(type))),
    missing: 'nothing in the graph crosses to another service',
    appears: 'once a build joins a request or a message',
  },
  routes: {
    from: 'graph',
    holds: (facts) => withGraph(facts, (graph) => graph.entryKinds.has('http')),
    missing: 'the graph holds no HTTP route',
    appears: 'once a build reads a route',
  },
  sources: {
    from: 'server options',
    holds: (facts) => facts.graph !== undefined && facts.sources,
    missing: 'the server was started with a database and no configuration, so no repository is known',
    appears: 'with --config',
  },
  tester: {
    from: 'server options',
    holds: (facts) => facts.tester,
    missing: 'the server was started without the readers that run a pattern',
    appears: 'under flowatlas mcp',
  },
} as const satisfies Record<string, NeedRow>;

export type Need = keyof typeof NEEDS;

/**
 * Each tool and what it needs: any one of the needs listed is enough
 * (`check_contract` compares a crossing, or traffic against its route).
 * `always` is a tool that answers from any graph, and before one is built
 * says to build it.
 */
export const TOOL_NEEDS = {
  start_here: ['always'],
  list_entries: ['always'],
  find_symbol: ['always'],
  get_flow: ['always'],
  who_calls: ['always'],
  impact: ['always'],
  search: ['always'],
  describe_for_prompt: ['always'],
  cant_follow: ['always'],
  dead: ['always'],
  findings: ['always'],
  get_source: ['sources'],
  who_emits: ['channels'],
  who_consumes: ['channels'],
  get_type: ['types'],
  type_usage: ['types'],
  check_contract: ['crossings', 'observed'],
  get_spec: ['routes', 'channels'],
  what_changed: ['changes'],
  check_rules: ['rules'],
  test_pattern: ['tester'],
  hot_paths: ['observed'],
  slow_steps: ['observed'],
  trace_for: ['observed'],
  undeclared_failures: ['observed'],
  never_seen: ['observed'],
} as const satisfies Record<string, readonly Need[]>;

export type ToolName = keyof typeof TOOL_NEEDS;

export const TOOL_NAMES: readonly ToolName[] = Object.keys(TOOL_NEEDS) as ToolName[];

export const isToolName = (name: string): name is ToolName => Object.hasOwn(TOOL_NEEDS, name);

/** Whether a tool can answer with what the server knows: one of its needs holds. */
export const canAnswer = (tool: ToolName, facts: ToolFacts): boolean => TOOL_NEEDS[tool].some((need) => NEEDS[need].holds(facts));
