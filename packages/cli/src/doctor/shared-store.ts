import type { Unresolved } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';

/**
 * The reason a row about a store more than one service writes carries (P228).
 *
 * A table two services write is a boundary they share: a change to its shape
 * in one is a change under the other. Sometimes that is the design, so it is a
 * note, not a finding (D5): it decides no exit code, and the row quotes the
 * rule a team writes when it is not the design (`only`, P114), without
 * applying it. Asked when `doctor` runs, from the graph.
 */
export const SHARED_STORE_REASON = 'store-shared';

/**
 * One row per service that writes a store more than one service writes, every
 * writer included, at the first place it writes it: no writer is the owner
 * until a rule says so (docs/CLI.md, "one row per writer").
 */
export const sharedStoreRows = (db: GraphDb, service?: string): Unresolved[] => {
  const writers = new Map<string, Map<string, { file: string; line: number }>>();
  for (const query of db.nodesByType('db_query')) {
    if (query.meta?.['op'] !== 'write' || query.repo === undefined) continue;
    for (const edge of db.edgesFrom(query.id, ['queries'])) {
      const byService = writers.get(edge.to) ?? new Map<string, { file: string; line: number }>();
      if (!byService.has(query.repo)) byService.set(query.repo, { file: query.file ?? '.', line: query.line ?? 1 });
      writers.set(edge.to, byService);
    }
  }
  const rows: Unresolved[] = [];
  for (const [storeId, byService] of [...writers].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (byService.size < 2) continue;
    const store = db.node(storeId);
    const label = store?.label ?? storeId;
    const names = [...byService.keys()].sort();
    for (const [writer, at] of [...byService].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (service !== undefined && writer !== service) continue;
      const others = names.filter((name) => name !== writer);
      rows.push({
        file: at.file,
        line: at.line,
        reason: SHARED_STORE_REASON,
        level: 'info',
        service: writer,
        symbol: storeId,
        message: `${writer} writes ${label}, which ${others.join(' and ')} ${others.length === 1 ? 'writes' : 'write'} too`,
        hint: `If only one service should write it, say so as a rule under rules in the configuration - { "name": "only-${names[0]}-writes-${label}", "only": { "from": { "service": "${names[0]}" }, "to": { "table": "${label}" }, "op": "write" } } - and flowatlas rules reports every other writer.`,
      });
    }
  }
  return rows;
};
