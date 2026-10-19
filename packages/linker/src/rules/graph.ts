/**
 * The graph a rule is checked against, read from a database (P114).
 *
 * One reader for the CLI and the MCP server, so `flowatlas rules` and
 * `check_rules` read the same nodes, the same edges and the same services
 * read in part. The evaluator itself never opens anything.
 */
import { causePartsOf, type RuleSet } from '@flowatlas/core';
import type { GraphDb } from '../db/reader.js';
import type { RuleGraph } from './types.js';

/** The cause a row records when a package it needed was not installed. */
const NOT_INSTALLED = 'module-not-installed';

/**
 * Services the build read in part (P75): skipped or failed, or with a step
 * that could not be followed because a package was not installed. A rule
 * over one is still checked, and says so.
 */
export const partialServicesOf = (db: Pick<GraphDb, 'report' | 'allUnresolved'>): string[] => {
  const partial = new Set<string>();
  for (const service of db.report()?.services ?? []) {
    if (service.skipped !== undefined) partial.add(service.name);
  }
  for (const row of db.allUnresolved()) {
    if (row.service === null) continue;
    if (causePartsOf({ ...row, ...(row.meta === undefined ? {} : { meta: row.meta }) }).some((part) => part.cause === NOT_INSTALLED)) partial.add(row.service);
  }
  return [...partial].sort();
};

/** Everything a rule reads, from one database and the tags the configuration gives. */
export const ruleGraphOf = (db: GraphDb, tags: RuleSet['tags'] = {}): RuleGraph => ({
  nodes: db.allNodes(),
  edges: db.allEdges(),
  tags,
  partial: partialServicesOf(db),
});
