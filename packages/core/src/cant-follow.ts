/**
 * What the reader could not follow, grouped by why (P75).
 *
 * Every row that says something was not read carries a reason; a row about a
 * step that could not be followed also carries the cause the code states for
 * it, under `meta.cause`, and the package it points into, under
 * `meta.package`. A row that stands for many places - every call on a
 * receiver with no class in one repository is one such row - carries the same
 * per cause under `meta.causes`, with a few of its places, so folding the list
 * never loses why.
 *
 * Read back here into one breakdown, by cause and by package, that `doctor
 * --unresolved`, the page and the MCP server all print: one function, so the
 * three can never disagree about a count.
 */
import { makeSymbolId } from './ids.js';
import { wasMissed, type Unresolved, type UnresolvedLevel } from './model/graph.js';
import type { FollowCause } from './follow-cause.js';
import { SEEN_NOT_IN_CODE, type BlindSpot } from './blind-spots.js';

/** The key on a row's `meta` naming why its step could not be followed. */
export const CAUSE_META = 'cause';
/** The key naming the package or module that cause points into. */
export const PACKAGE_META = 'package';
/** The key on a folded row listing its places by cause. */
export const CAUSES_META = 'causes';

/** How many places a folded row keeps per cause, to point at. */
export const CAUSE_SAMPLES = 3;

/** One place a cause was met. */
export interface CauseSample {
  file: string;
  line: number;
  symbol?: string;
  service?: string;
}

/** The places one cause, into one package, stands for within a row. */
export interface CausePart {
  cause: string;
  package?: string;
  sites: number;
  samples: CauseSample[];
}

/** The `meta` a row carries for its cause. */
export const causeMeta = (found: FollowCause | undefined): { meta?: Record<string, unknown> } =>
  found === undefined
    ? {}
    : {
        meta: {
          [CAUSE_META]: found.cause,
          ...(found.package === undefined ? {} : { [PACKAGE_META]: found.package }),
        },
      };

/**
 * The cause a row stands for when it records none of its own.
 *
 * A handful of reasons are one cause under another name; every other reason is
 * its own cause, so a row is never left out of the breakdown for having no
 * finer answer.
 */
const CAUSE_OF_REASON: ReadonlyMap<string, string> = new Map([
  ['call-through-token', 'untyped-di-token'],
  ['call-module-ref', 'container-lookup'],
  ['di-token-unknown', 'token-not-provided'],
  ['di-token-ambiguous', 'token-ambiguous'],
]);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** A row's own cause: the one it records, or the one its reason is. */
export const causeOfRow = (row: { reason: string; meta?: Record<string, unknown> }): FollowCause => {
  const cause = text(row.meta?.[CAUSE_META]);
  const pkg = text(row.meta?.[PACKAGE_META]);
  return {
    cause: cause ?? CAUSE_OF_REASON.get(row.reason) ?? row.reason,
    ...(pkg === undefined ? {} : { package: pkg }),
  };
};

const samplesOf = (value: unknown): CauseSample[] =>
  Array.isArray(value)
    ? value.flatMap((item): CauseSample[] => {
        const sample = item as Partial<CauseSample> | null;
        if (sample === null || typeof sample.file !== 'string' || typeof sample.line !== 'number') return [];
        return [{ file: sample.file, line: sample.line, ...(typeof sample.symbol === 'string' ? { symbol: sample.symbol } : {}) }];
      })
    : [];

/** What a row stands for, cause by cause. A row of one place is one part. */
export const causePartsOf = (row: {
  reason: string;
  file?: string | null;
  line?: number | null;
  sites?: number;
  symbol?: string | null;
  meta?: Record<string, unknown>;
}): CausePart[] => {
  const listed = row.meta?.[CAUSES_META];
  if (Array.isArray(listed)) {
    const parts = listed.flatMap((item): CausePart[] => {
      const part = item as Partial<CausePart> | null;
      if (part === null || typeof part.cause !== 'string' || typeof part.sites !== 'number') return [];
      return [{
        cause: part.cause,
        ...(typeof part.package === 'string' ? { package: part.package } : {}),
        sites: part.sites,
        samples: samplesOf(part.samples),
      }];
    });
    if (parts.length > 0) return parts;
  }
  const own = causeOfRow(row);
  return [{
    ...own,
    sites: row.sites ?? 1,
    samples: [{
      file: row.file ?? '',
      line: row.line ?? 0,
      ...(row.symbol === undefined || row.symbol === null ? {} : { symbol: row.symbol }),
    }],
  }];
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const partKey = (part: { cause: string; package?: string }): string => `${part.cause}\u0000${part.package ?? ''}`;

/**
 * Adds the rows folded into one to the parts it lists.
 *
 * Called by the builder as it folds: every row added is one place, and the
 * first few of each cause are kept to point at.
 */
export class CauseTally {
  readonly #parts = new Map<string, CausePart>();
  #recorded = false;

  add(row: Unresolved): void {
    if (row.meta?.[CAUSE_META] !== undefined) this.#recorded = true;
    const own = causeOfRow(row);
    const key = partKey(own);
    const part = this.#parts.get(key) ?? { ...own, sites: 0, samples: [] };
    this.#parts.set(key, part);
    part.sites += row.sites ?? 1;
    if (part.samples.length < CAUSE_SAMPLES) {
      part.samples.push({ file: row.file, line: row.line, ...(row.symbol === undefined ? {} : { symbol: row.symbol }) });
    }
  }

  /** Whether any row folded in said why; a fold of rows that never did adds nothing. */
  get recorded(): boolean {
    return this.#recorded;
  }

  /** The parts, most places first, then by cause and package. */
  parts(): CausePart[] {
    return [...this.#parts.values()].sort(
      (a, b) => b.sites - a.sites || cmp(a.cause, b.cause) || cmp(a.package ?? '', b.package ?? ''),
    );
  }
}

/** A place in the breakdown: where, and in which service. */
export interface CantFollowSample {
  service?: string;
  file: string;
  line: number;
  symbol?: string;
}

/** One package under one cause. `package` is null when the cause points into none. */
export interface CantFollowPackage {
  package: string | null;
  sites: number;
  samples: CantFollowSample[];
}

/** One cause, the places it stands for, and the packages it points into. */
export interface CantFollowCause {
  cause: string;
  /** `cause:package` when every place points into one package, else the cause. */
  label: string;
  sites: number;
  /** The reasons the rows carry, so a reader can find them in the ordinary list. */
  reasons: string[];
  /** What to do about it. */
  hint: string;
  services: string[];
  packages: CantFollowPackage[];
  /** Packages left out by `top`. */
  truncated?: number;
  /**
   * Under `seen-not-in-code` (P110): what traffic reached that no reader drew,
   * one group per service and kind, most spans first. Its rows name no file,
   * so the cause lists these in place of packages.
   */
  seen?: BlindSpot[];
}

/** One package, and the causes that point into it. */
export interface CantFollowByPackage {
  package: string;
  sites: number;
  causes: Array<{ cause: string; sites: number }>;
}

/** Everything the reader could not follow, by cause and by package. */
export interface CantFollow {
  /** Rows and the places they stand for: equal to `doctor`'s `rows` and `sites`. */
  total: { rows: number; sites: number };
  causes: CantFollowCause[];
  packages: CantFollowByPackage[];
  /** Causes and packages left out by `top`. Absent when nothing was cut. */
  truncated?: { causes?: number; packages?: number };
}

/** The rows the breakdown reads: a stored or a written row, with its meta. */
export interface CantFollowRow {
  reason: string;
  level?: UnresolvedLevel;
  sites?: number;
  file?: string | null;
  line?: number | null;
  symbol?: string | null;
  service?: string | null;
  hint?: string | null;
  meta?: Record<string, unknown>;
}

export interface CantFollowOptions {
  /** Most causes, packages per cause, and packages listed. Default 10. */
  top?: number;
  /** Most places listed per package under a cause. Default 3. */
  samples?: number;
  /** Only rows of this service. */
  service?: string;
  /** Only this cause. */
  cause?: string;
  /** Only this package. */
  package?: string;
  /** Causes to skip before the first one listed, to read the list a page at a time (P93). Default 0. */
  offset?: number;
}

/**
 * What to do about each cause, in one sentence. A cause the catalogue does not
 * name is a reason, and the row's own hint says it.
 */
const CAUSE_HINTS: ReadonlyMap<string, (pkg: string | undefined) => string> = new Map<string, (pkg: string | undefined) => string>([
  ['module-not-installed', (pkg) => `Install the repository's dependencies so ${pkg ?? 'the package'} resolves, or describe it in a shape file (flowatlas shapes --suggest); until then nothing typed by it can be followed.`],
  ['import-unresolved', (pkg) => `${pkg === undefined ? 'The import' : `\`${pkg}\``} resolves to no file: check the path, or the tsconfig paths and baseUrl it relies on.`],
  ['re-export-missing', (pkg) => `The module${pkg === undefined ? '' : ` ${pkg}`} resolves but exports no such name; the index that should re-export it is missing the line.`],
  ['any-typed', (pkg) => `Declared as any${pkg === undefined ? '' : ` by ${pkg}`}; give it a class type to make the call visible.`],
  ['language-any', () => "Typed as any by the language's own declarations - JSON.parse, a caught error; give the value a type where it is made."],
  ['unknown-typed', () => 'Declared as unknown; narrow it to a class before the call.'],
  ['untyped-parameter', () => 'A parameter with no type and no default; annotate it with the class it holds.'],
  ['callback-param', () => "A callback's parameter the called function's signature does not type; annotate it, or type the function it is passed to."],
  ['untyped-value', () => 'A value the checker could not type from how it was made; annotate it where it is declared.'],
  ['name-undeclared', () => 'A name nothing declares: a global the compiler was not told about, or a typo.'],
  ['dynamic-member', () => 'The method is chosen at run time, as obj[key](); there is nothing static to follow.'],
  ['this-outside-class', () => '`this` in a function that belongs to no class means whatever the caller binds.'],
  ['no-base-class', () => '`super` in a class that extends nothing this repository can read.'],
  ['union-receiver', () => 'Typed as a union, so the call could go to any member; narrow it first.'],
  ['interface-type', () => 'Typed by an interface or a type with no class behind it; type it as the class, or inject one.'],
  ['object-literal', () => 'A plain object whose member is not a function written in place; there is no one body to follow.'],
  ['function-value', () => 'A function value rather than a class; call the function by name to make it visible.'],
  ['module-namespace', () => 'A module imported whole; call its functions by name to make them visible.'],
  ['generic-receiver', () => 'Typed by a type parameter; the class is whatever each caller passes.'],
  ['function-field', () => 'A field given its function from elsewhere; declare it as a method to make the edge visible.'],
  ['other-type', () => 'The receiver has no single class type; inject a class to make the edge visible.'],
  ['untyped-di-token', () => 'Provided by a token with a value or a factory, so no class is known; provide it with a class.'],
  ['container-lookup', () => 'Resolved through the container at run time; inject the class instead.'],
  ['token-not-provided', () => 'No module of this repository provides the token; register a provider for it.'],
  ['token-ambiguous', () => 'More than one class is registered for the token; which one is in effect depends on module order.'],
  [SEEN_NOT_IN_CODE, () => 'Traffic reached this and no reader drew it: a route registered at run time, a service not in the configuration, or a reader gap. Look for it with the call beside it; a later build that reads it makes the row go away.'],
  ['data-layer-unnamed', () => 'Looks like a data layer of this repository by name; name its base under adapters.db.localBaseClasses. A call the graph already draws into a repository method of this repository is not listed.'],
]);

/** Whether the catalogue has a sentence for this cause. */
export const isKnownCause = (cause: string): boolean => CAUSE_HINTS.has(cause);

/** Every cause the catalogue names, sorted: what an unknown cause is told it could have meant (P94). */
export const knownCauses = (): string[] => [...CAUSE_HINTS.keys()].sort(cmp);

/** What to do about a cause, or undefined when it is a reason with a hint of its own. */
export const hintForCause = (cause: string, pkg?: string): string | undefined => CAUSE_HINTS.get(cause)?.(pkg);

/** `module-not-installed:@scope/name`, or the cause alone. */
export const causeLabel = (cause: string, pkg?: string | null): string =>
  pkg === undefined || pkg === null ? cause : `${cause}:${pkg}`;

interface Acc {
  cause: string;
  sites: number;
  reasons: Set<string>;
  services: Set<string>;
  hint?: string;
  packages: Map<string, { package: string | null; sites: number; samples: CantFollowSample[] }>;
  seen: BlindSpot[];
}

/** A blind-spot group a row carries (P110), when it is one. */
const seenOf = (row: CantFollowRow): BlindSpot | undefined => {
  const seen = row.reason === SEEN_NOT_IN_CODE ? row.meta?.['seen'] : undefined;
  return typeof seen === 'object' && seen !== null && typeof (seen as BlindSpot).kind === 'string' ? (seen as BlindSpot) : undefined;
};

/**
 * Every row that says something was not read, by cause and then by package.
 *
 * Only gaps are here (`wasMissed`): rows at `nothing` stand for places with no
 * edge to draw, and notes and findings (P81) say how something was joined or
 * something about the code, none of them a step the reader could not follow.
 * Sorted most places first; ties by name, so two runs over one graph print one
 * list.
 */
export const groupCantFollow = (rows: readonly CantFollowRow[], options: CantFollowOptions = {}): CantFollow => {
  const top = options.top ?? 10;
  const samples = options.samples ?? CAUSE_SAMPLES;
  const causes = new Map<string, Acc>();
  const packages = new Map<string, Map<string, number>>();
  let rowCount = 0;
  let siteCount = 0;

  for (const row of rows) {
    if (!wasMissed(row)) continue;
    if (options.service !== undefined && (row.service ?? '') !== options.service) continue;
    const parts = causePartsOf(row).filter(
      (part) =>
        (options.cause === undefined || part.cause === options.cause) &&
        (options.package === undefined || part.package === options.package),
    );
    if (parts.length === 0) continue;
    rowCount += 1;
    for (const part of parts) {
      siteCount += part.sites;
      const acc: Acc = causes.get(part.cause) ?? {
        cause: part.cause,
        sites: 0,
        reasons: new Set<string>(),
        services: new Set<string>(),
        packages: new Map(),
        seen: [],
      };
      causes.set(part.cause, acc);
      acc.sites += part.sites;
      acc.reasons.add(row.reason);
      if (row.service !== undefined && row.service !== null && row.service !== '') acc.services.add(row.service);
      if (acc.hint === undefined && row.hint !== undefined && row.hint !== null && row.hint !== '') acc.hint = row.hint;
      // A blind spot is a place in traffic, not in a file: its group stands
      // where a package would, and no place is listed for it.
      const spot = seenOf(row);
      if (spot !== undefined) {
        acc.seen.push(spot);
        continue;
      }
      const pkgKey = part.package ?? '';
      const byPkg = acc.packages.get(pkgKey) ?? { package: part.package ?? null, sites: 0, samples: [] };
      acc.packages.set(pkgKey, byPkg);
      byPkg.sites += part.sites;
      for (const sample of part.samples) {
        if (byPkg.samples.length >= samples) break;
        byPkg.samples.push({
          ...(row.service === undefined || row.service === null || row.service === '' ? {} : { service: row.service }),
          file: sample.file,
          line: sample.line,
          ...(sample.symbol === undefined ? {} : { symbol: sample.symbol }),
        });
      }
      if (part.package !== undefined) {
        const into = packages.get(part.package) ?? new Map<string, number>();
        packages.set(part.package, into);
        into.set(part.cause, (into.get(part.cause) ?? 0) + part.sites);
      }
    }
  }

  const ranked = [...causes.values()].sort((a, b) => b.sites - a.sites || cmp(a.cause, b.cause));
  const offset = Math.min(options.offset ?? 0, ranked.length);
  const listed: CantFollowCause[] = ranked.slice(offset, offset + top).map((acc) => {
    const byPkg = [...acc.packages.values()].sort(
      (a, b) => b.sites - a.sites || cmp(a.package ?? '', b.package ?? ''),
    );
    const only = byPkg.length === 1 ? byPkg[0]?.package : null;
    return {
      cause: acc.cause,
      label: causeLabel(acc.cause, only),
      sites: acc.sites,
      reasons: [...acc.reasons].sort(cmp),
      hint: hintForCause(acc.cause, only ?? undefined) ?? acc.hint ?? acc.cause,
      services: [...acc.services].sort(cmp),
      packages: byPkg.slice(0, top),
      ...(byPkg.length > top ? { truncated: byPkg.length - top } : {}),
      ...(acc.seen.length === 0
        ? {}
        : {
            seen: [...acc.seen].sort(
              (a, b) => b.count - a.count || cmp(a.service ?? '', b.service ?? '') || cmp(a.kind, b.kind),
            ),
          }),
    };
  });

  const byPackage: CantFollowByPackage[] = [...packages.entries()]
    .map(([pkg, into]) => ({
      package: pkg,
      sites: [...into.values()].reduce((sum, n) => sum + n, 0),
      causes: [...into.entries()]
        .map(([cause, sites]) => ({ cause, sites }))
        .sort((a, b) => b.sites - a.sites || cmp(a.cause, b.cause)),
    }))
    .sort((a, b) => b.sites - a.sites || cmp(a.package, b.package));

  // Causes past this page; the ones before it were listed on an earlier one.
  const cutCauses = ranked.length - offset - listed.length;
  const cutPackages = byPackage.length - Math.min(byPackage.length, top);
  return {
    total: { rows: rowCount, sites: siteCount },
    causes: listed,
    packages: byPackage.slice(0, top),
    ...(cutCauses > 0 || cutPackages > 0
      ? { truncated: { ...(cutCauses > 0 ? { causes: cutCauses } : {}), ...(cutPackages > 0 ? { packages: cutPackages } : {}) } }
      : {}),
  };
};

/**
 * The node a place is written in, when the graph draws it.
 *
 * A row's symbol is a node id some of the time, and the rest of the time the
 * text of a call - `OrdersService.place -> this.steps[sku]` - whose left side
 * is the caller's own name, which with the service and the file spells the
 * caller's id. `has` says which ids the graph holds; nothing is guessed past it.
 */
export const placeIdOf = (sample: CantFollowSample, has: (id: string) => boolean): string | undefined => {
  const symbol = sample.symbol;
  if (symbol === undefined) return undefined;
  if (has(symbol)) return symbol;
  if (sample.service === undefined || sample.file === '') return undefined;
  const caller = symbol.split(' -> ')[0]?.replace(/@\d+$/, '').trim();
  if (caller === undefined || caller === '' || /\s/.test(caller)) return undefined;
  try {
    const id = makeSymbolId(sample.service, sample.file, caller);
    return has(id) ? id : undefined;
  } catch {
    return undefined;
  }
};
