import type { TypeEntry } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { Command } from 'commander';
import { openDbFromOptions } from '../db.js';
import { withQueryOptions, type QueryOptions } from '../options.js';
import { processIo, settingsFor, type QueryIo } from '../query/answer.js';

export interface TypesOptions extends QueryOptions {
  drift?: boolean;
  name?: string;
}

type Registered = TypeEntry & { id: string };

/** What this check can and cannot see, said on the output rather than in a manual. */
export const DRIFT_NOTE = 'hash-only; run flowatlas contracts for a field-by-field comparison';

export const EMPTY_NOTE = '0 types; was build run with --no-types?';

/** `Order*Dto` the way a shell means it, not the way a regular expression does. */
export const globToRegExp = (glob: string): RegExp => {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
};

/** A declaration that came from a package the services share, not from one of them. */
const isShared = (entry: Registered): boolean => entry.meta?.['sharedPackage'] !== undefined;

const repoOf = (entry: Registered): string => /^type:([^#]+)#/.exec(entry.id)?.[1] ?? '';

export interface Drift {
  name: string;
  declarations: Array<{ id: string; service: string; structuralHash: string; declaredIn: string }>;
}

/**
 * The same name declared differently in two repositories.
 *
 * Names and hashes only: whether the difference matters on the wire is a
 * contract question and belongs to the phase that knows the wire rules. A
 * declaration that comes from a shared package is the same declaration seen
 * twice, so it can never drift from itself and is left out.
 */
export const driftOf = (entries: readonly Registered[]): Drift[] => {
  const byName = new Map<string, Registered[]>();
  for (const entry of entries) {
    if (isShared(entry)) continue;
    byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
  }

  const drifted: Drift[] = [];
  for (const [name, group] of byName) {
    const services = new Set(group.map(repoOf));
    const hashes = new Set(group.map((entry) => entry.structuralHash));
    if (services.size < 2 || hashes.size < 2) continue;
    drifted.push({
      name,
      declarations: [...group]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((entry) => ({
          id: entry.id,
          service: repoOf(entry),
          structuralHash: entry.structuralHash,
          declaredIn: entry.declaredIn,
        })),
    });
  }
  return drifted.sort((a, b) => (a.name < b.name ? -1 : 1));
};

const driftLines = (drifted: readonly Drift[]): string[] => {
  if (drifted.length === 0) return ['no drift: every name means the same structure everywhere'];
  const lines: string[] = [];
  for (const item of drifted) {
    lines.push(`${item.name}  declared ${item.declarations.length} ways`);
    for (const declaration of item.declarations) {
      lines.push(
        `  ${declaration.service.padEnd(14)} ${declaration.structuralHash.slice(0, 12)}  ${declaration.declaredIn}`,
      );
    }
  }
  lines.push(DRIFT_NOTE);
  return lines;
};

const listLines = (entries: readonly Registered[], detail: number): string[] => {
  const lines: string[] = [];
  for (const entry of entries) {
    if (detail <= 0) {
      lines.push(entry.id);
      continue;
    }
    lines.push(
      `${entry.id.padEnd(44)} ${entry.kind.padEnd(8)} ${entry.structuralHash.slice(0, 12)}  ${entry.declaredIn}`,
    );
    if (detail < 2) continue;
    for (const field of entry.fields ?? []) {
      lines.push(`    ${field.name}${field.optional ? '?' : ''}: ${field.type}`);
    }
  }
  lines.push(`${entries.length} type(s)`);
  return lines;
};

const registryOf = (db: GraphDb, options: TypesOptions, service?: string): Registered[] => {
  const all = db.allTypes(service === undefined ? {} : { repo: service });
  if (options.name === undefined) return all;
  const pattern = globToRegExp(options.name);
  return all.filter((entry) => pattern.test(entry.name));
};

/** The registry, listed or compared. */
export const runTypes = (options: TypesOptions, io: QueryIo = processIo): void => {
  const settings = settingsFor(options, io, ['json', 'tree']);
  const db = openDbFromOptions(settings);
  const entries = registryOf(db, options, settings.service);

  if (entries.length === 0 && options.name === undefined && settings.service === undefined) {
    io.out(
      settings.format === 'json'
        ? `${JSON.stringify({ types: [], total: 0, note: EMPTY_NOTE }, null, 2)}\n`
        : `${EMPTY_NOTE}\n`,
    );
    return;
  }

  if (options.drift === true) {
    const drifted = driftOf(entries);
    io.out(
      settings.format === 'json'
        ? `${JSON.stringify({ drift: drifted, note: DRIFT_NOTE }, null, 2)}\n`
        : `${driftLines(drifted).join('\n')}\n`,
    );
    return;
  }

  if (settings.format === 'json') {
    io.out(
      `${JSON.stringify(
        {
          types: entries.map((entry) => ({
            id: entry.id,
            name: entry.name,
            kind: entry.kind,
            ...(settings.detail <= 0
              ? {}
              : { declaredIn: entry.declaredIn, structuralHash: entry.structuralHash }),
            ...(settings.detail >= 2 && entry.fields !== undefined ? { fields: entry.fields } : {}),
          })),
          total: entries.length,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  io.out(`${listLines(entries, settings.detail).join('\n')}\n`);
};

export const registerTypes = (program: Command): void => {
  withQueryOptions(
    program.command('types').description('the type registry, listed or compared across repositories'),
    { formats: ['json', 'tree'], walks: false },
  )
    .option('--drift', 'only names declared differently in two repositories')
    .option('--name <glob>', 'only names matching this pattern')
    .action((options: TypesOptions) => {
      runTypes(options);
    });
};
