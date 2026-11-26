import { ENTRY_KINDS, type GraphNode } from '@flowatlas/core';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Singular and plural, since a summary that says "1 entries" reads as a bug. */
const KIND_LABEL: Record<string, [string, string]> = {
  http: ['http entry', 'http entries'],
  bot_command: ['bot command', 'bot commands'],
  bot_callback: ['bot callback', 'bot callbacks'],
  bot_event: ['bot event', 'bot events'],
  scene_step: ['scene step', 'scene steps'],
  event: ['consumer', 'consumers'],
  rpc: ['rpc entry', 'rpc entries'],
  cron: ['cron job', 'cron jobs'],
  workflow: ['workflow', 'workflows'],
  task: ['task', 'tasks'],
  screen: ['screen', 'screens'],
};

export interface ReachableGroup {
  kind: string;
  count: number;
  services: string[];
}

/** Entry points grouped the way the report wording groups them. */
export const groupEntries = (entries: readonly GraphNode[]): ReachableGroup[] => {
  const groups = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const kind = entry.kind ?? 'http';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    groups.set(kind, (groups.get(kind) ?? new Set()).add(entry.repo));
  }
  const order = [...ENTRY_KINDS, ...[...counts.keys()].filter((kind) => !ENTRY_KINDS.includes(kind as never))];
  return order
    .filter((kind) => counts.has(kind))
    .map((kind) => ({
      kind,
      count: counts.get(kind) as number,
      services: [...(groups.get(kind) ?? [])].sort(cmp),
    }));
};

/**
 * The one line P12's report repeats, so both say the same thing.
 *
 * `withoutEntry` names services the chain runs into and stops in, which are in
 * the blast radius whether or not anything was found above them. Leaving them
 * out is how "1 http entry (admin-api)" came to be the whole answer for a change
 * a bot in another repository also reaches.
 */
export const reachableSummary = (
  entries: readonly GraphNode[],
  withoutEntry: readonly string[] = [],
): string => {
  const groups = groupEntries(entries);
  const head =
    groups.length === 0
      ? 'Reachable from: no entry points'
      : `Reachable from: ${groups
          .map((group) => {
            const label = KIND_LABEL[group.kind] ?? [group.kind, `${group.kind}s`];
            return `${group.count} ${label[group.count === 1 ? 0 : 1]} (${group.services.join(', ')})`;
          })
          .join(', ')}`;
  if (withoutEntry.length === 0) return head;
  const also = withoutEntry.join(', ');
  return `${head}. Also reaches ${also}, where the chain stops before an entry point`;
};
