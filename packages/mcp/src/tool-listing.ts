import { statSync } from 'node:fs';
import { ConfigInvalidError, observedPathFor, ruleSetOf, type McpSettings } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DbHandle } from './query/db.js';
import { nearWords } from './query/names.js';
import { loadObservedCounts } from './query/observed.js';
import { canAnswer, isToolName, NEEDS, TOOL_NAMES, TOOL_NEEDS, type Need, type ToolFacts, type ToolName } from './tool-needs.js';
import { changeDocumentsBeside } from './tools/changes.js';
import { respond } from './tools/common.js';

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
  options: { allTools?: boolean; configPath?: string } = {},
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
  if (options.allTools === true) return { tools: 'all', include: new Set(), exclude: new Set() };
  return { tools: settings?.tools ?? 'auto', include, exclude };
};

type Handler = (request: never, extra: never) => unknown;

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
    this.#rules = options.handle.config !== undefined && ruleSetOf(options.handle.config).rules.length > 0;
    this.#pollMs = options.pollMs ?? LISTING_POLL_MS;
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
    this.#server.registerTool = ((name: string, ...rest: unknown[]) => {
      if (!isToolName(name)) throw new Error(`tool ${name} has no row in TOOL_NEEDS (tool-needs.ts)`);
      const tool = (registerTool as (...args: unknown[]) => RegisteredTool).call(this.#server, name, ...rest);
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

  /** The SDK's list and call handlers, with the list decided first and a hidden tool's call answered here. */
  #guard(schema: unknown, handler: Handler): Handler {
    if (schema === ListToolsRequestSchema) {
      return ((request: never, extra: never) => {
        this.refresh(false);
        this.start();
        return handler(request, extra);
      }) as Handler;
    }
    if (schema === CallToolRequestSchema) {
      return ((request: { params: { name: string } }, extra: never) => {
        this.refresh(true);
        this.start();
        const refused = this.refusal(request.params.name);
        return refused === undefined ? handler(request as never, extra) : respond(refused);
      }) as Handler;
    }
    return handler;
  }
}
