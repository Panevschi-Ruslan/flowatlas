import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Gaps a project has looked at and decided to live with (P72).
 *
 * A baseline accepts a number; this accepts a gap by name, so `doctor` and the
 * checks show only the gaps nobody has looked at yet. Kept beside `graph.db` as
 * `accepted.json`:
 *
 *   {
 *     acceptedFormatVersion: 1,
 *     gaps: [{ reason, service?, file?, note, acceptedAt }]
 *   }
 *
 * An entry with only a reason accepts that reason everywhere; one with a
 * service, everywhere in that service; one with a file, in that file. No line
 * and no symbol: the database keeps neither in a form that survives a
 * reformat, and an accepted gap that comes back after an import was added is
 * worse than none.
 */
export const ACCEPTED_FILE = 'accepted.json';
export const ACCEPTED_FORMAT_VERSION = 1;

export interface AcceptedGap {
  reason: string;
  service?: string;
  file?: string;
  /** Why it was accepted, in a person's words. */
  note: string;
  /** ISO-8601. */
  acceptedAt: string;
}

export interface AcceptedFile {
  acceptedFormatVersion: number;
  gaps: AcceptedGap[];
}

/** What a gap is matched on, whichever way it was read. */
export interface GapLike {
  reason: string;
  service?: string | null;
  file?: string | null;
}

const acceptedSchema = z.object({
  acceptedFormatVersion: z.literal(ACCEPTED_FORMAT_VERSION),
  gaps: z.array(
    z.object({
      reason: z.string().min(1),
      service: z.string().optional(),
      file: z.string().optional(),
      note: z.string(),
      acceptedAt: z.string(),
    }),
  ),
});

const GAP_PREFIX = 'gap:';

/** The id a gap answers to everywhere: `gap:<service>|<file>|<reason>`. */
export const gapIdOf = (gap: GapLike): string =>
  `${GAP_PREFIX}${gap.service ?? ''}|${gap.file ?? ''}|${gap.reason}`;

export const isGapId = (value: string): boolean => value.startsWith(GAP_PREFIX);

/** A gap id read back into what it names; empty parts name nothing. */
export const parseGapId = (id: string): GapLike | undefined => {
  if (!isGapId(id)) return undefined;
  const parts = id.slice(GAP_PREFIX.length).split('|');
  if (parts.length !== 3 || parts[2] === '') return undefined;
  const [service, file, reason] = parts as [string, string, string];
  return {
    reason,
    ...(service === '' ? {} : { service }),
    ...(file === '' ? {} : { file }),
  };
};

const fits = (wanted: string | undefined, actual: string | null | undefined): boolean =>
  wanted === undefined || wanted === (actual ?? '');

/** Whether one accepted entry covers one gap. */
export const covers = (entry: GapLike, gap: GapLike): boolean =>
  entry.reason === gap.reason &&
  fits(entry.service ?? undefined, gap.service) &&
  fits(entry.file ?? undefined, gap.file);

/** The entry that covers a gap, when one does. */
export const acceptedFor = (
  accepted: readonly AcceptedGap[],
  gap: GapLike,
): AcceptedGap | undefined => accepted.find((entry) => covers(entry, gap));

/** Splits gaps into the new ones and the accepted ones, order kept. */
export const splitAccepted = <T extends GapLike>(
  accepted: readonly AcceptedGap[],
  gaps: readonly T[],
): { fresh: T[]; accepted: T[] } => {
  const fresh: T[] = [];
  const known: T[] = [];
  for (const gap of gaps) (acceptedFor(accepted, gap) === undefined ? fresh : known).push(gap);
  return { fresh, accepted: known };
};

export const acceptedPathFor = (dbPath: string): string => join(dirname(dbPath), ACCEPTED_FILE);

/** The accepted gaps beside a database; none when there is no file or it cannot be read. */
export const loadAccepted = (dbPath: string): AcceptedGap[] => {
  const path = acceptedPathFor(dbPath);
  if (!existsSync(path)) return [];
  try {
    return acceptedSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).gaps as AcceptedGap[];
  } catch {
    return [];
  }
};

const order = (a: AcceptedGap, b: AcceptedGap): number => {
  const left = gapIdOf(a);
  const right = gapIdOf(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

/** Writes the list sorted, so two people accepting the same gaps write the same file. */
export const saveAccepted = (dbPath: string, gaps: readonly AcceptedGap[]): string => {
  const path = acceptedPathFor(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  const file: AcceptedFile = { acceptedFormatVersion: ACCEPTED_FORMAT_VERSION, gaps: [...gaps].sort(order) };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  return path;
};

const sameTarget = (a: GapLike, b: GapLike): boolean => gapIdOf(a) === gapIdOf(b);

/** The list with one entry added, or its note replaced when it was there already. */
export const withAccepted = (gaps: readonly AcceptedGap[], entry: AcceptedGap): AcceptedGap[] => [
  ...gaps.filter((gap) => !sameTarget(gap, entry)),
  entry,
];

/** The list without one entry. */
export const withoutAccepted = (gaps: readonly AcceptedGap[], target: GapLike): AcceptedGap[] =>
  gaps.filter((gap) => !sameTarget(gap, target));
