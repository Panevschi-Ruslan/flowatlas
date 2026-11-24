import { statSync } from 'node:fs';
import { ConfigInvalidError, observedPathFor, ruleSetOf, type FlowatlasConfig, type McpSettings } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { listedTools } from './listed-schema.js';
import { compactAnswer, compactOutputSchema, FULL_ANSWER_TOOLS } from './compact.js';
import { offeredOnly, offeredText, type Offer } from './offered.js';
import type { DbHandle } from './query/db.js';
import { loggedCall, questionLogSettings, type QuestionLogSettings } from './query/questions.js';
import { nearWords } from './query/names.js';
import { loadObservedCounts } from './query/observed.js';
import { serviceNamed, type ServiceNamed } from './query/service-name.js';
import { canAnswer, isToolName, NEEDS, TOOL_NAMES, TOOL_NEEDS, type Need, type ToolFacts, type ToolName } from './tool-needs.js';
import { changeDocumentsBeside } from './tools/changes.js';
import { pluralAsked, respond, verboseInput } from './tools/common.js';
import { isCoreTool, withAlwaysLoad } from './upfront.js';

/**
 * The tools a session is offered follow the project (P201).
 *
 * Every tool is registered; the ones whose needs do not hold are disabled,
 * so `tools/list` leaves them out and the client is told with one
 * `notifications/tools/list_changed` when that changes. The list is decided
 * again before every `tools/list` and `tools/call`, whenever the database
 * opens or a build replaced it, and every couple of seconds while a client
 * is connected if the graph, the observed file or a diff beside it changed:
 * after a first `flowatlas observe` the run-time tools appear with no
 * restart. A call to a tool not listed - a client that kept an older list -
 * answers what it needs, as any failed call does.
 */

/** Which tools are listed, as the configuration or the command line said it. */
export interface ListingSettings {
  tools: 'auto' | 'all';
  include: ReadonlySet<ToolName>;
  exclude: ReadonlySet<ToolName>;
  /**
   * Whether the core tools are listed to load upfront (P380): `mcp.alwaysLoad`
   * in the configuration, off with `flowatlas mcp --no-always-load`.
   */
  alwaysLoad: boolean;
}

/** How often a connected server looks for a graph, an observed file or a diff that changed. */
export const LISTING_POLL_MS = 2000;

/**
 * The `mcp` block read into settings, or a configuration error naming each
 * tool it names that the server does not have. `allTools` (`--all-tools`)
 * lists every tool, whatever the block says.
 */
export const listingSettingsOf = (
  settings: McpSettings | undefined,
  options: { allTools?: boolean; alwaysLoad?: boolean; configPath?: string } = {},
): ListingSettings => {
  const issues: string[] = [];
  const named = (key: 'include' | 'exclude'): Set<ToolName> => {
    const found = new Set<ToolName>();
    (settings?.[key] ?? []).forEach((name, index) => {
      if (isToolName(name)) found.add(name);
      else {
        const near = nearWords(TOOL_NAMES, name, 1)[0];
        issues.push(`mcp.${key}.${index}: no tool is named ${JSON.stringify(name)}${near === undefined ? '' : `; did you mean ${near}?`}`);
      }
    });
    return found;
  };
  const include = named('include');
  const exclude = named('exclude');
  if (issues.length > 0) {
    throw new ConfigInvalidError(options.configPath ?? 'flowatlas.config.json', issues, `The tools are: ${TOOL_NAMES.join(', ')}.`);
  }
  // Off when either says so: the command line cannot turn on what the configuration turned off.
  const alwaysLoad = options.alwaysLoad !== false && settings?.alwaysLoad !== false;
  if (options.allTools === true) return { tools: 'all', include: new Set(), exclude: new Set(), alwaysLoad };
  return { tools: settings?.tools ?? 'auto', include, exclude, alwaysLoad };
};

type Handler = (request: never, extra: never) => unknown;

/**
 * The tools whose `service` is read against services of their own (P377): a
 * diff's two sides, where a service the graph no longer holds is still a
 * service. A folder name is read as the service there too; a name that is
 * none is the tool's to answer.
 */
const SERVICES_OF_THEIR_OWN: ReadonlySet<string> = new Set(['what_changed']);

/**
 * A tool's configuration with `verbose` among its inputs (P365): every tool
 * takes it, whether or not its inputs spread `commonInput`, except one whose
 * answer is never compacted and one that takes no input at all.
 */
const withVerbose = <T extends { inputSchema?: Record<string, unknown> }>(name: string, config: T): T => {
  if (config?.inputSchema === undefined || FULL_ANSWER_TOOLS.has(name) || 'verbose' in config.inputSchema) return config;
  return { ...config, inputSchema: { ...config.inputSchema, verbose: verboseInput } };
};

/** A `tools/list` answer whose output schemas a compact answer fits (P365): see `compactOutputSchema`. */
const listedCompact = (listed: unknown): unknown => {
  if (listed instanceof Promise) return listed.then(listedCompact);
  const answer = listed as { tools?: Array<{ outputSchema?: unknown }> } | undefined;
  if (answer?.tools === undefined) return listed;
  return {
    ...answer,
    tools: answer.tools.map((tool) => (tool.outputSchema === undefined ? tool : { ...tool, outputSchema: compactOutputSchema(tool.outputSchema) })),
  };
};

/** Whether a configuration holds an architecture rule, which `check_rules` needs (read once: the configuration is not read again). */
export const rulesConfigured = (config: FlowatlasConfig | undefined): boolean => config !== undefined && ruleSetOf(config).rules.length > 0;

/** Why no code is served, when `get_source` is not listed: said after where to read it instead (P360). */
export const noCodeSaid = (settings: ListingSettings): string =>
  settings.exclude.has('get_source') ? 'this server is set not to serve code (mcp.exclude)' : 'the code is not served from a database alone';

/**
 * The tools this server can never list, whatever is built (P360): turned off
 * by `mcp.exclude`, or needing only what the server was started without - a
 * configuration (`get_source`), its rules (`check_rules`), the pattern
 * tester. Decided once, before the first question, so the instructions a
 * session is given at the start name none of them.
 */
export const neverListed = (settings: ListingSettings, started: { sources: boolean; rules: boolean; tester: boolean }): Set<ToolName> => {
  const facts: ToolFacts = {
    graph: { nodes: new Set(), entryKinds: new Set(), edges: new Set(), types: 0 },
    observed: false,
    changes: false,
    ...started,
  };
  const fixed = (need: Need): boolean => NEEDS[need].from === 'server options' || NEEDS[need].from === 'configuration';
  return new Set(
    TOOL_NAMES.filter((name) => {
      if (settings.exclude.has(name)) return true;
      if (settings.tools === 'all' || settings.include.has(name)) return false;
      const needs: readonly Need[] = TOOL_NEEDS[name];
      return needs.every((need) => fixed(need) && !NEEDS[need].holds(facts));
    }),
  );
};

/** A file's timestamp, or -1 when there is none: what the poll compares. */
const stamped = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
};

/** What the graph holds that a need asks about, read once per database. */
const graphFactsOf = (db: GraphDb): NonNullable<ToolFacts['graph']> => {
  const held = db.held();
  return { nodes: new Set(held.nodes), entryKinds: new Set(held.entryKinds), edges: new Set(held.edges), types: db.counts().types };
};

export interface ListingOptions {
  handle: DbHandle;
  settings: ListingSettings;
  /** Whether the server was handed the pattern tester (`test_pattern`). */
  tester: boolean;
  /** How often to look for changes while connected; 0 never looks. */
  pollMs?: number;
}

export class ToolListing {
  readonly #server: McpServer;
  readonly #handle: DbHandle;
  readonly #settings: ListingSettings;
  readonly #tester: boolean;
  /** Read once: the configuration is not read again while the server runs. */
  readonly #rules: boolean;
  readonly #pollMs: number;
  /** Whether each call is logged (P235), read once as the rules are. */
  readonly #log: QuestionLogSettings;
  readonly #tools = new Map<ToolName, RegisteredTool>();
  #graph: { generation: number; facts: NonNullable<ToolFacts['graph']> } | undefined;
  #facts: ToolFacts | undefined;
  #refreshing = false;
  #stamp = '';
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(server: McpServer, options: ListingOptions) {
    this.#server = server;
    this.#handle = options.handle;
    this.#settings = options.settings;
    this.#tester = options.tester;
    this.#rules = rulesConfigured(options.handle.config);
    this.#pollMs = options.pollMs ?? LISTING_POLL_MS;
    this.#log = questionLogSettings(options.handle.config);
    options.handle.onChange(() => this.refresh(true));
  }

  /**
   * Runs `register`, keeping each tool it registers, and puts this listing in
   * front of the `tools/list` and `tools/call` handlers the SDK installs on
   * the first one. Refuses a tool with no row in the table, and a row with
   * no tool: the table is every tool, once.
   */
  capture(register: () => void): void {
    const sdk = this.#server.server;
    const setRequestHandler = sdk.setRequestHandler;
    const registerTool = this.#server.registerTool;
    sdk.setRequestHandler = ((schema: unknown, handler: Handler) =>
      setRequestHandler.call(sdk, schema as never, this.#guard(schema, handler) as never)) as typeof sdk.setRequestHandler;
    this.#server.registerTool = ((name: string, config: { inputSchema?: Record<string, unknown> }, ...rest: unknown[]) => {
      if (!isToolName(name)) throw new Error(`tool ${name} has no row in TOOL_NEEDS (tool-needs.ts)`);
      const tool = (registerTool as (...args: unknown[]) => RegisteredTool).call(this.#server, name, this.#upfront(name, withVerbose(name, config)), ...rest);
      this.#tools.set(name, tool);
      return tool;
    }) as McpServer['registerTool'];
    try {
      register();
    } finally {
      sdk.setRequestHandler = setRequestHandler;
      this.#server.registerTool = registerTool;
    }
    const unregistered = TOOL_NAMES.filter((name) => !this.#tools.has(name));
    if (unregistered.length > 0) throw new Error(`TOOL_NEEDS has rows for tools never registered: ${unregistered.join(', ')}`);
  }

  /** The tools listed now, in the order the table holds them. */
  listed(): ToolName[] {
    return TOOL_NAMES.filter((name) => this.#tools.get(name)?.enabled === true);
  }

  /**
   * Decides the list again and, when it changed and `notify`, tells the
   * client once. A `tools/list` decides without telling: its answer is the
   * news.
   */
  refresh(notify: boolean): void {
    // Opening the database below may report a change, which lands here again.
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      const facts = this.#read();
      this.#facts = facts;
      let changed = false;
      for (const [name, tool] of this.#tools) {
        const listed = this.#lists(name, facts);
        if (tool.enabled === listed) continue;
        // Set rather than enable()/disable(), each of which would send its own notification.
        tool.enabled = listed;
        changed = true;
      }
      this.#stamp = this.#stampNow();
      if (changed && notify) this.#server.sendToolListChanged();
    } finally {
      this.#refreshing = false;
    }
  }

  /** Looks for a changed graph, observed file or diff every `pollMs` until `stop`. */
  start(): void {
    if (this.#timer !== undefined || this.#pollMs <= 0) return;
    this.#timer = setInterval(() => {
      if (this.#stampNow() !== this.#stamp) this.refresh(true);
    }, this.#pollMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /**
   * What `start_here` says about the tools not listed, in one line: each
   * group of tools and when it appears (`hot_paths, slow_steps: after
   * flowatlas observe · check_rules: after rules[] in flowatlas.config.json`).
   * Undefined when every tool is listed.
   */
  hiddenLine(): string | undefined {
    const groups = new Map<string, ToolName[]>();
    for (const name of TOOL_NAMES) {
      if (this.#tools.get(name)?.enabled !== false) continue;
      const when = this.#settings.exclude.has(name) ? 'off in mcp.exclude' : this.#needsOf(name).map((need) => NEEDS[need].appears).join(' or ');
      groups.set(when, [...(groups.get(when) ?? []), name]);
    }
    if (groups.size === 0) return undefined;
    return [...groups].map(([when, names]) => `${names.join(', ')}: ${when}`).join(' · ');
  }

  /**
   * What an answer may name now (P360): the tools not listed, and where a
   * symbol's code is to be read when `get_source` is one of them. Undefined
   * when every tool is listed.
   */
  offer(): Offer | undefined {
    const hidden = new Set(TOOL_NAMES.filter((name) => this.#tools.get(name)?.enabled === false));
    if (hidden.size === 0) return undefined;
    const handle = this.#handle;
    return {
      hidden,
      noCode: noCodeSaid(this.#settings),
      readAt: (symbol, line) => {
        const opened = handle.open();
        const node = 'db' in opened ? opened.db.node(symbol) : undefined;
        if (node?.file === undefined) return undefined;
        const at = line ?? node.line;
        return `${at === undefined ? node.file : `${node.file}:${at}`}${node.repo === '' ? '' : ` in ${node.repo}`}`;
      },
    };
  }

  /** A prompt's text with no call to a tool not listed (P360), the list decided first as before a call. */
  offeredPrompt(result: GetPromptResult): GetPromptResult {
    this.refresh(true);
    const offer = this.offer();
    if (offer === undefined) return result;
    return {
      ...result,
      messages: result.messages.map((message) =>
        message.content.type === 'text' ? { ...message, content: { ...message.content, text: offeredText(message.content.text, offer) } } : message,
      ),
    };
  }

  /** Why a tool is not listed, as the answer to a call of it; undefined for a listed one. */
  refusal(name: string): { error: string; needs: Need[] } | undefined {
    if (!isToolName(name) || this.#tools.get(name)?.enabled !== false) return undefined;
    const needs = this.#needsOf(name);
    if (this.#settings.exclude.has(name)) {
      return { error: `${name} is turned off by mcp.exclude in ${this.#handle.configPath ?? 'the configuration'}`, needs };
    }
    if (this.#facts?.graph === undefined && !needs.includes('tester')) {
      const opened = this.#handle.open();
      if ('error' in opened) return { error: `${name} is not listed until a graph is built: ${opened.error}`, needs };
    }
    const missing = needs.map((need) => NEEDS[need].missing).join(', and ');
    const appears = needs.map((need) => NEEDS[need].appears).join(' or ');
    return { error: `${name} is not listed for this project: ${missing}; it appears ${appears}`, needs };
  }

  /**
   * A core tool's configuration marked to load upfront (P380), unless the
   * settings turned that off: `tools/list` then carries
   * `_meta: {"anthropic/alwaysLoad": true}` on exactly the core tools listed.
   */
  #upfront<T extends object>(name: string, config: T): T {
    if (!this.#settings.alwaysLoad || !isCoreTool(name)) return config;
    return { ...config, _meta: withAlwaysLoad((config as { _meta?: Record<string, unknown> })._meta) };
  }

  #needsOf(name: ToolName): Need[] {
    return [...TOOL_NEEDS[name]];
  }

  #lists(name: ToolName, facts: ToolFacts): boolean {
    if (this.#settings.exclude.has(name)) return false;
    if (this.#settings.tools === 'all' || this.#settings.include.has(name)) return true;
    return canAnswer(name, facts);
  }

  #read(): ToolFacts {
    const handle = this.#handle;
    const opened = handle.open();
    let graph: ToolFacts['graph'];
    if (!('error' in opened)) {
      if (this.#graph?.generation !== handle.generation) this.#graph = { generation: handle.generation, facts: graphFactsOf(opened.db) };
      graph = this.#graph.facts;
    }
    return {
      ...(graph === undefined ? {} : { graph }),
      observed: loadObservedCounts(handle.path) !== undefined,
      changes: changeDocumentsBeside(handle.path).length > 0,
      rules: this.#rules,
      sources: handle.config !== undefined,
      tester: this.#tester,
    };
  }

  /** The graph's, the observed file's and the diffs' timestamps: what the poll compares. */
  #stampNow(): string {
    const path = this.#handle.path;
    return [stamped(path), stamped(observedPathFor(path)), ...changeDocumentsBeside(path)].join('|');
  }

  /** The service a `service` input names, read against the services the graph records; as said where no graph opens. */
  #serviceNamed(said: string): ServiceNamed {
    const opened = this.#handle.open();
    return 'db' in opened ? serviceNamed(opened.db.services(), said) : { service: said };
  }

  /** The SDK's list and call handlers, with the list decided first and a hidden tool's call answered here. */
  #guard(schema: unknown, handler: Handler): Handler {
    if (schema === ListToolsRequestSchema) {
      return ((request: never, extra: never) => {
        this.refresh(false);
        this.start();
        // The shared inputs said once (P366), and output schemas that require nothing, for compact answers (P365).
        return listedTools(listedCompact(handler(request, extra)));
      }) as Handler;
    }
    if (schema === CallToolRequestSchema) {
      return ((request: { params: { name: string; arguments?: Record<string, unknown> } }, extra: never) => {
        this.refresh(true);
        this.start();
        const refused = this.refusal(request.params.name);
        if (refused !== undefined) return respond(refused);
        // `verbose` is the boundary's, not the tool's (P365): the tool answers as it always has, and is never told.
        // Several inputs said any way a guide teaches (`ids`, a list in the single input) are the tool's list (P381).
        const { verbose, ...asked } = pluralAsked(request.params.name, request.params.arguments ?? {});
        const compact = verbose !== true && !FULL_ANSWER_TOOLS.has(request.params.name);
        // A service said by its repository's folder is the service (P377); one named nowhere answers the services there are.
        const said = typeof asked['service'] === 'string' ? this.#serviceNamed(asked['service']) : undefined;
        // A diff's services are its two sides', not the graph's: one gone from the graph is still asked of it.
        const named = said !== undefined && 'error' in said && SERVICES_OF_THEIR_OWN.has(request.params.name) ? undefined : said;
        if (named !== undefined && 'service' in named) asked['service'] = named.service;
        // The service whose callers are kept (P381) is named the same way.
        const callersIn = typeof asked['callersIn'] === 'string' ? this.#serviceNamed(asked['callersIn']) : undefined;
        if (callersIn !== undefined && 'service' in callersIn) asked['callersIn'] = callersIn.service;
        const notNamed = named !== undefined && 'error' in named ? named : callersIn !== undefined && 'error' in callersIn ? callersIn : undefined;
        const toTool = request.params.arguments === undefined ? request : { ...request, params: { ...request.params, arguments: asked } };
        const answered = () =>
          notNamed !== undefined ? respond(notNamed) : this.#offered(handler(toTool as never, extra), compact);
        if (!this.#log.enabled) return answered();
        // Logged here, once for every tool, so a tool added later is logged too (P235).
        const handle = this.#handle;
        const db = (): GraphDb | undefined => {
          const opened = handle.open();
          return 'db' in opened ? opened.db : undefined;
        };
        const call = { via: 'mcp' as const, tool: request.params.name, args: request.params.arguments ?? {} };
        return loggedCall({ settings: this.#log, dbPath: handle.path, db }, call, answered);
      }) as Handler;
    }
    return handler;
  }

  /**
   * An answer with no suggestion of a tool not listed (P360), and compact
   * unless it was asked `verbose` (P365), whichever tool wrote it: the one
   * place every answer passes, so a tool added later is held to both too.
   * The text and `structuredContent` stay one document.
   */
  #offered(result: unknown, compact: boolean): unknown {
    if (result instanceof Promise) return result.then((settled: unknown) => this.#offered(settled, compact));
    const offer = this.offer();
    const answer = result as { content?: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown> } | undefined;
    const first = answer?.content?.[0];
    if ((offer === undefined && !compact) || answer === undefined || first?.type !== 'text' || typeof first.text !== 'string') return result;
    let document: unknown;
    try {
      document = answer.structuredContent ?? JSON.parse(first.text);
    } catch {
      if (offer === undefined) return result;
      return { ...answer, content: [{ ...first, text: offeredText(first.text, offer) }, ...(answer.content ?? []).slice(1)] };
    }
    const offered = offer === undefined ? document : offeredOnly(document, offer);
    const kept = compact ? compactAnswer(offered) : offered;
    if (kept === document) return result;
    const text = JSON.stringify(kept);
    return {
      ...answer,
      content: [{ ...first, text }, ...(answer.content ?? []).slice(1)],
      ...(answer.structuredContent === undefined ? {} : { structuredContent: JSON.parse(text) as Record<string, unknown> }),
    };
  }
}
