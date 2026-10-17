/**
 * What identifies a result across two runs (P115, D2).
 *
 * The baseline already decided what makes two findings the same after an
 * edit: `unresolvedKey`, `findingKey`, a rule violation's key, a node id with
 * its line taken off. A fingerprint is that key, hashed, under a version of
 * its own (`flowatlas/v1`, I11), so a reformat keeps an alert open and a fix
 * closes it.
 *
 * GitHub's code scanning reads one partial fingerprint only,
 * `primaryLocationLineHash`, and computes it from the text of the line when a
 * log has none. Written from the same key, the alert follows the finding
 * rather than the line; the `:<n>` after it counts findings that share a key
 * in one run, as GitHub's own does.
 */
import { createHash } from 'node:crypto';
import { findingKey, type ContractFinding } from '@flowatlas/contracts';
import type { Unresolved } from '@flowatlas/core';
import { stableNodeKey } from '@flowatlas/linker';
import { unresolvedKey } from '../doctor/baseline.js';

/** The version of the key below; bump it when what goes into a key changes meaning. */
export const FINGERPRINT_VERSION = 'flowatlas/v1';

/** The partial fingerprint GitHub matches alerts on. */
export const GITHUB_FINGERPRINT = 'primaryLocationLineHash';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * The fingerprint of one key of one kind. The kind is part of it, so a
 * contract finding and a rule violation can never share one.
 */
export const fingerprintOf = (kind: string, key: string): string => hash(`${kind}\u0000${key}`).slice(0, 32);

/** The key of each kind of row, from the function that already keys it. */
export const KEYS = {
  unresolved: (row: Pick<Unresolved, 'service' | 'file' | 'symbol' | 'reason'>): string =>
    unresolvedKey(row as Unresolved),
  contract: (finding: ContractFinding): string => findingKey(finding),
  /** An annotation is named by the symbol it is on, which carries no line. */
  marker: (issue: { service: string; file: string; symbol: string; code: string }): string =>
    `${issue.service}|${issue.file}|${issue.symbol}|${issue.code}`,
  node: (id: string, label?: string): string => stableNodeKey(id, label),
  /** A cycle is its members, whichever one the walk started from. */
  cycle: (nodes: readonly string[]): string => [...new Set(nodes.map((id) => stableNodeKey(id)))].sort().join(' '),
} as const;

/**
 * Both partial fingerprints of a result, given how many results before it in
 * the run had the same one.
 */
export const partialFingerprints = (fingerprint: string, occurrence: number): Record<string, string> => ({
  [FINGERPRINT_VERSION]: fingerprint,
  [GITHUB_FINGERPRINT]: `${fingerprint.slice(0, 16)}:${occurrence}`,
});
