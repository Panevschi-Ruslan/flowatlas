import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ContractBreak } from '@flowatlas/linker';

/** The file `flowatlas contracts` (and a build) writes beside the database. */
const CONTRACTS_FILE = 'contracts.json';

const cache = new Map<string, { mtime: number; breaks: ContractBreak[] }>();

const isBreak = (value: unknown): value is ContractBreak => {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<ContractBreak>;
  return (
    typeof item.severity === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.message === 'string' &&
    typeof item.edge?.from === 'string' &&
    typeof item.edge.to === 'string'
  );
};

/**
 * The contract findings the last check wrote beside a database (P95), or none.
 *
 * Read loosely, as the CLI's `dead` reads the checker: the contracts package is
 * not a dependency of this one, and a report of another version, or none, is
 * an answer with no contract breaks rather than an error. Reread only when the
 * file changes.
 */
export const loadContractBreaks = (dbPath: string): ContractBreak[] => {
  const path = join(dirname(dbPath), CONTRACTS_FILE);
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return [];
  }
  const held = cache.get(path);
  if (held !== undefined && held.mtime === mtime) return held.breaks;
  let breaks: ContractBreak[] = [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { findings?: unknown };
    breaks = Array.isArray(parsed.findings) ? parsed.findings.filter(isBreak) : [];
  } catch {
    breaks = [];
  }
  cache.set(path, { mtime, breaks });
  return breaks;
};
