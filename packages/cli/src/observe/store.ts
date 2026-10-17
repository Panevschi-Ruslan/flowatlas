import { writeFileSync } from 'node:fs';
import { observedPathFor, readObserved, type Observed, type ObservedRead } from '@flowatlas/core';

export { OBSERVED_FILE, observedPathFor } from '@flowatlas/core';

/** The observed file beside a database, and why there is none when it is there and cannot be read. */
export const readObservedBeside = (dbPath: string): ObservedRead => {
  const read = readObserved(observedPathFor(dbPath));
  return read.problem?.kind === 'missing' ? {} : read;
};

/** The observed file beside a database, or nothing when there is none or it cannot be read. */
export const loadObserved = (dbPath: string): Observed | undefined => readObservedBeside(dbPath).observed;

export const saveObserved = (dbPath: string, observed: Observed): string => {
  const path = observedPathFor(dbPath);
  writeFileSync(path, `${JSON.stringify(observed, null, 2)}\n`, 'utf8');
  return path;
};
