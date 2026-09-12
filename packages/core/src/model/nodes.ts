/**
 * Node kinds of the graph model.
 *
 * The list is closed on purpose: a new node kind is a schema change and must
 * bump `SCHEMA_VERSION`. `type` is deliberately absent — types live in the
 * separate registry (see `model/types.ts`) and are referenced by id only.
 */
export const NODE_TYPES = [
  'repo',
  'service',
  'module',
  'entry',
  'provider',
  'method',
  'function',
  'guard',
  'interceptor',
  'pipe',
  'middleware',
  'db_query',
  'table',
  'cache_op',
  'channel',
  'producer',
  'consumer',
  'http_out',
  'external_api',
  'ui_component',
  'ui_action',
  'ui_api_call',
  'config_key',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Every flavour of entry point the model knows about.
 *
 * All of them are ordinary `entry` nodes: nothing downstream may branch on the
 * kind to decide whether a node is a "real" entry point. A button tap and an
 * HTTP route are the same thing here.
 */
export const ENTRY_KINDS = [
  'http',
  'bot_command',
  'bot_callback',
  'bot_event',
  'scene_step',
  'event',
  'rpc',
  'cron',
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export const isEntryKind = (value: string): value is EntryKind =>
  (ENTRY_KINDS as readonly string[]).includes(value);

export interface GraphNode {
  /** Stable identifier. See `ids.ts` for the grammar of every id form. */
  id: string;
  type: NodeType;
  /** Human-readable short label. Never parsed. */
  label: string;
  /**
   * Owning repository, equal to `services[].name`.
   *
   * For nodes that are shared across the whole project (`channel`,
   * `external_api`) this records where the node was first observed and is not
   * part of its identity — the linker deduplicates those by id alone.
   */
  repo: string;
  /** Repo-relative POSIX path. */
  file?: string;
  line?: number;
  /** Sub-classification. For `entry` nodes it is always an `EntryKind`. */
  kind?: string;
  meta?: Record<string, unknown>;
}
