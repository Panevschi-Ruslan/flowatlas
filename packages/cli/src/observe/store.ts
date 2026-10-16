import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OBSERVED_FORMAT_VERSION, type Observed } from './match.js';

/** Beside `graph.db`, in the output directory. */
export const OBSERVED_FILE = 'observed.json';

export const observedPathFor = (dbPath: string): string => join(dirname(dbPath), OBSERVED_FILE);

/** The observed file beside a database, or nothing when there is none or it is of another version. */
export const loadObserved = (dbPath: string): Observed | undefined => {
  const path = observedPathFor(dbPath);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Observed;
    return parsed.observedFormatVersion === OBSERVED_FORMAT_VERSION ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const saveObserved = (dbPath: string, observed: Observed): string => {
  const path = observedPathFor(dbPath);
  writeFileSync(path, `${JSON.stringify(observed, null, 2)}\n`, 'utf8');
  return path;
};
