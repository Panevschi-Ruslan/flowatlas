import type { ToolName } from './tool-needs.js';

/**
 * The tools a session has from its first turn (P380).
 *
 * Claude Code defers every MCP tool by default: the model sees only their
 * names, and spends a turn on a ToolSearch call before its first question,
 * a turn that re-sends the whole session's context. A tool listed with
 * `_meta: {"anthropic/alwaysLoad": true}` is loaded upfront instead (Claude
 * Code v2.1.285 or later), its schema in context from the first turn. Every
 * upfront tool is paid on every turn, asked or not, so the set is the few
 * tools nearly every question takes, chosen from what agents asked: who
 * calls, the ways in, a channel's handlers, a contract, a symbol, what breaks,
 * a name, a flow, dead code. `who_emits`, `get_source` and the rest load by
 * ToolSearch when a question needs them.
 *
 * The one source of the set: the server marks these, and the guide `flowatlas
 * agents install` writes names them.
 */
export const CORE_TOOLS: readonly ToolName[] = Object.freeze([
  'who_calls',
  'list_entries',
  'who_consumes',
  'check_contract',
  'find_symbol',
  'impact',
  'search',
  'get_flow',
  'dead',
] satisfies ToolName[]);

/** The `_meta` key Claude Code reads on a listed tool to load it upfront. */
export const ALWAYS_LOAD_KEY = 'anthropic/alwaysLoad';

/** The most characters Claude Code keeps of an upfront tool's description, and of the server's instructions. */
export const UPFRONT_DESCRIPTION_MAX = 4096;

/**
 * The most characters the upfront tools' listing may run to as a model reads
 * it (name, description and input schema of each): it is sent on every turn.
 * Measured at 5,633 for the nine on the main fixture (the nine the guide had
 * loaded by ToolSearch were 5,870); the ceiling the next 50 above, and one more.
 */
export const UPFRONT_LISTING_MAX = 5700;

/** Whether a tool is one of the core set. */
export const isCoreTool = (name: string): boolean => (CORE_TOOLS as readonly string[]).includes(name);

/** A tool's `_meta` with the upfront mark added, keeping whatever else it holds. */
export const withAlwaysLoad = (meta: Record<string, unknown> | undefined): Record<string, unknown> => ({ ...meta, [ALWAYS_LOAD_KEY]: true });
