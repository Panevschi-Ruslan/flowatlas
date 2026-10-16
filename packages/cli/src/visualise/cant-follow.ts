import { groupCantFollow, placeIdOf } from '@flowatlas/core';
import type { AnchoredUnresolvedRow } from '@flowatlas/linker';

/**
 * What the reader could not follow, for the Not joined tab (P75): by cause,
 * then by package, then a few places each.
 *
 * Bounded rather than indexed into the dictionaries: a dozen causes with a few
 * places each is a few kilobytes on any project, and the page reads it as it
 * is. A place is `[service, file, line, symbol, node]`, where `node` is the
 * position of the method or function it is written in, -1 when the page has
 * none.
 */
export interface PackedCantFollow {
  total: { rows: number; sites: number };
  causes: Array<{
    /** The cause code. */
    c: string;
    /** `cause:package` when every place is in one package, else the cause. */
    l: string;
    /** Places. */
    s: number;
    /** What to do. */
    h: string;
    /** The reasons its rows carry. */
    r: string[];
    /** Services. */
    v: string[];
    /** By package: `n` is null when the cause points into none. */
    p: Array<{ n: string | null; s: number; x: Array<[string, string, number, string, number]> }>;
    /** Packages left out. */
    more?: number;
  }>;
  /** By package: `c` is `[cause, places]`. */
  packages: Array<{ n: string; s: number; c: Array<[string, number]> }>;
  /** Causes and packages left out. */
  more?: { causes?: number; packages?: number };
}

/** How many causes and packages the tab lists; `doctor --unresolved` lists any number. */
export const CANT_FOLLOW_TOP = 12;

export const packCantFollow = (
  rows: readonly AnchoredUnresolvedRow[],
  position: ReadonlyMap<string, number>,
): { cantFollow?: PackedCantFollow } => {
  const grouped = groupCantFollow(
    rows.map((row) => ({ ...row, symbol: row.node })),
    { top: CANT_FOLLOW_TOP, samples: 3 },
  );
  if (grouped.total.sites === 0) return {};
  const has = (id: string): boolean => position.has(id);
  return {
    cantFollow: {
      total: grouped.total,
      causes: grouped.causes.map((cause) => ({
        c: cause.cause,
        l: cause.label,
        s: cause.sites,
        h: cause.hint,
        r: cause.reasons,
        v: cause.services,
        p: cause.packages.map((pkg) => ({
          n: pkg.package,
          s: pkg.sites,
          x: pkg.samples.map((sample): [string, string, number, string, number] => {
            const id = placeIdOf(sample, has);
            return [sample.service ?? '', sample.file, sample.line, sample.symbol ?? '', id === undefined ? -1 : (position.get(id) ?? -1)];
          }),
        })),
        ...(cause.truncated === undefined ? {} : { more: cause.truncated }),
      })),
      packages: grouped.packages.map((pkg) => ({
        n: pkg.package,
        s: pkg.sites,
        c: pkg.causes.map((cause): [string, number] => [cause.cause, cause.sites]),
      })),
      ...(grouped.truncated === undefined ? {} : { more: grouped.truncated }),
    },
  };
};
