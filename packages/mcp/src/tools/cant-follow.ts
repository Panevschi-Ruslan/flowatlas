import {
  causeLabel,
  causePartsOf,
  countsOf,
  describeAcceptedProblem,
  groupCantFollow,
  kindOfRow,
  knownCauses,
  packageCoverage,
  placeIdOf,
  readAccepted,
  wasMissed,
  type CantFollow,
  type CantFollowSample,
  type PackageCover,
} from '@flowatlas/core';
import { acceptedSplitOf, findingKindOf, type AnchoredUnresolvedRow, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { nearWords } from '../query/names.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { callOf, nextOutput, pageInput, READ_ONLY, serviceInput, withDb, type ToolContext } from './common.js';

/** A place, with the id of the method or function it is written in when the graph draws one. */
export interface CantFollowPlace extends CantFollowSample {
  loc: string;
  /** Id of the node the place is in, for get_source. Absent when the graph draws none. */
  id?: string;
  /**
   * Under `module-not-installed`: what the configuration as it stands now
   * reads in place of the package - its source in a repository, or a shape
   * file - so a rebuild is all the place needs (P78).
   */
  coveredBy?: PackageCover['by'];
}

/** The cause a shape file or a package's source answers. */
const MISSING = 'module-not-installed';

export interface CantFollowAnswer extends Omit<CantFollow, 'causes'> {
  causes: Array<Omit<CantFollow['causes'][number], 'packages'> & {
    packages: Array<{
      package: string | null;
      label: string;
      sites: number;
      samples: CantFollowPlace[];
      /** Under `module-not-installed`: what would read in its place once rebuilt, and where that is. */
      coveredBy?: PackageCover['by'];
      coveredFrom?: string;
    }>;
  }>;
  /** Gaps accepted with `flowatlas accept`, out of every count above. */
  accepted?: { rows: number; sites: number };
  /**
   * Rows of the same scope that are not steps the reader missed, and so in none
   * of the counts above (P81): notes on how a join or a reading was made, and
   * findings about the code. `findings()` lists the findings ranked by reach
   * (P95), `search({kinds: ["gaps"]})` both, each with its kind. Absent when
   * there are none.
   */
  apart?: { notes: number; findings: number };
  /** Set when `accepted.json` could not be read, so nothing was left out (P80). */
  note?: string;
}


/** The breakdown, with each place said as `file:line` and the id of what it is in. */
export const cantFollowFor = (
  db: GraphDb,
  rows: readonly AnchoredUnresolvedRow[],
  options: { service?: string; cause?: string; package?: string; top: number; samples: number; offset?: number },
  coverage: ReadonlyMap<string, PackageCover> = new Map(),
): CantFollowAnswer => {
  const grouped = groupCantFollow(
    rows.map((row) => ({ ...row, symbol: row.node })),
    options,
  );
  return {
    ...grouped,
    causes: grouped.causes.map((cause) => ({
      ...cause,
      packages: cause.packages.map((pkg) => {
        const cover = cause.cause === MISSING && pkg.package !== null ? coverage.get(pkg.package) : undefined;
        return {
          package: pkg.package,
          label: causeLabel(cause.cause, pkg.package),
          sites: pkg.sites,
          samples: pkg.samples.map((sample) => {
            const id = placeIdOf(sample, (candidate) => db.node(candidate) !== undefined);
            return {
              ...sample,
              loc: `${sample.file}:${sample.line}`,
              ...(id === undefined ? {} : { id }),
              ...(cover === undefined ? {} : { coveredBy: cover.by }),
            };
          }),
          ...(cover === undefined ? {} : { coveredBy: cover.by, coveredFrom: cover.from }),
        };
      }),
    })),
  };
};

/**
 * A place as it goes out (P93): `loc` and the id of what it is in. `file` and
 * `line` are what `loc` says, `symbol` is said only where it is not the id (a
 * call text, or a symbol the graph draws no node for), and `service` only
 * where the cause spans more than one.
 */
export interface WirePlace {
  loc: string;
  id?: string;
  symbol?: string;
  service?: string;
}

/** A cause's package as it goes out: its places, and what covers it once for all of them. */
export interface WirePackage {
  package: string | null;
  sites: number;
  samples: WirePlace[];
  coveredBy?: PackageCover['by'];
  coveredFrom?: string;
}

export interface CantFollowWire extends Omit<CantFollowAnswer, 'causes' | 'total'> {
  total: CantFollowAnswer['total'] & { causes: number };
  causes: Array<Omit<CantFollowAnswer['causes'][number], 'packages'> & { packages: WirePackage[] }>;
  nextOffset?: number;
}

const wirePlace = (place: CantFollowPlace, oneService: boolean): WirePlace => ({
  loc: place.loc,
  ...(place.id === undefined ? {} : { id: place.id }),
  ...(place.symbol === undefined || place.symbol === place.id ? {} : { symbol: place.symbol }),
  ...(place.service === undefined || oneService ? {} : { service: place.service }),
});

/**
 * The answer slimmed for the wire (D4: `cantFollowFor` keeps its shape for the
 * CLI). A package's label is its cause and its name, both said beside it, so
 * it is left out too.
 */
export const wireCantFollow = (answer: CantFollowAnswer, offset: number): CantFollowWire => {
  const { total, causes, packages, truncated } = answer;
  const more = truncated?.causes ?? 0;
  return {
    total: { ...total, causes: offset + causes.length + more },
    causes: causes.map((cause) => ({
      ...cause,
      packages: cause.packages.map((pkg) => ({
        package: pkg.package,
        sites: pkg.sites,
        samples: pkg.samples.map((place) => wirePlace(place, cause.services.length <= 1)),
        ...(pkg.coveredBy === undefined ? {} : { coveredBy: pkg.coveredBy }),
        ...(pkg.coveredFrom === undefined ? {} : { coveredFrom: pkg.coveredFrom }),
      })),
    })),
    packages,
    ...(truncated === undefined ? {} : { truncated }),
    ...(more > 0 ? { nextOffset: offset + causes.length } : {}),
  };
};

const placeOutput = z.object({
  loc: z.string(),
  id: z.string().optional(),
  symbol: z.string().optional(),
  service: z.string().optional(),
});

/** What cant_follow answers: causes, one page at a time, then the packages they point into. */
export const cantFollowOutput = {
  total: z.object({ rows: z.number(), sites: z.number(), causes: z.number() }),
  causes: z.array(
    z.object({
      cause: z.string(),
      label: z.string(),
      sites: z.number(),
      reasons: z.array(z.string()),
      hint: z.string(),
      services: z.array(z.string()),
      packages: z.array(
        z.object({
          package: z.string().nullable(),
          sites: z.number(),
          samples: z.array(placeOutput),
          coveredBy: z.enum(['repo', 'shape']).optional(),
          coveredFrom: z.string().optional(),
        }),
      ),
      truncated: z.number().optional(),
    }),
  ),
  packages: z.array(
    z.object({
      package: z.string(),
      sites: z.number(),
      causes: z.array(z.object({ cause: z.string(), sites: z.number() })),
    }),
  ),
  truncated: z.object({ causes: z.number().optional(), packages: z.number().optional() }).optional(),
  nextOffset: z.number().optional(),
  accepted: z.object({ rows: z.number(), sites: z.number() }).optional(),
  apart: z.object({ notes: z.number(), findings: z.number() }).optional(),
  note: z.string().optional(),
  next: nextOutput,
};

/**
 * The calls that take what this answer named: the code at the first place,
 * then one cause and one package to narrow to.
 */
const nextOf = (answer: CantFollowWire, asked: { cause?: string; package?: string }): string[] => {
  const hints: string[] = [];
  const first = answer.causes[0];
  const place = first?.packages.flatMap((pkg) => pkg.samples).find((sample) => sample.id !== undefined);
  if (place?.id !== undefined) hints.push(`get_source({symbol: ${JSON.stringify(place.id)}})`);
  // A package nobody installed is answered by a shape file, or by a rebuild
  // where the configuration already reads something in its place (P78).
  const missing = answer.causes.find((cause) => cause.cause === MISSING)?.packages.find((pkg) => pkg.package !== null);
  if (missing?.package !== undefined && missing.package !== null && (asked.cause === MISSING || first?.cause === MISSING)) {
    hints.push(
      missing.coveredBy === undefined
        ? `run: flowatlas shapes --suggest --package ${JSON.stringify(missing.package)}`
        : `run: flowatlas build (${missing.package} is covered by ${missing.coveredBy === 'repo' ? 'its source in' : 'the shape file'} ${missing.coveredFrom ?? ''})`,
    );
  }
  if (asked.cause === undefined && first !== undefined) hints.push(`cant_follow({cause: ${JSON.stringify(first.cause)}})`);
  const pkg = answer.packages[0]?.package;
  if (asked.package === undefined && pkg !== undefined) {
    hints.push(`cant_follow({package: ${JSON.stringify(pkg)}})`, `search({query: ${JSON.stringify(pkg)}})`);
  }
  return hints.slice(0, MAX_NEXT);
};

/** Whether a row stands for this cause, by the cause it records or by its reason. */
const carries = (row: AnchoredUnresolvedRow, cause: string): boolean =>
  row.reason === cause || causePartsOf(row).some((part) => part.cause === cause);

/** How rows that are not steps the reader missed are said, by what they are (P81's kinds). */
const notMissedSaid = (cause: string, rows: readonly AnchoredUnresolvedRow[]): string => {
  const findings = rows.filter((row) => kindOfRow(row) === 'finding').length;
  const notes = rows.filter((row) => kindOfRow(row) === 'note').length;
  const nothing = rows.length - findings - notes;
  if (findings === rows.length) return `${cause} is a finding, not a step the reader missed: ${rows.length} rows`;
  if (notes === rows.length) return `${cause} is a note on how something was read, not a step the reader missed: ${rows.length} rows`;
  if (nothing === rows.length) return `${cause} rows are places with nothing to join, not steps the reader missed: ${rows.length} rows`;
  const parts = [
    ...(findings > 0 ? [`${findings} findings`] : []),
    ...(notes > 0 ? [`${notes} notes`] : []),
    ...(nothing > 0 ? [`${nothing} with nothing to join`] : []),
  ];
  return `${cause} rows are not steps the reader missed: ${parts.join(', ')}`;
};

/**
 * Why a cause asked for answers no causes (P94): its rows are findings or
 * notes, or were accepted, or it has none in this scope, or there is no such
 * cause, which is an error naming the ones there are. An empty breakdown is
 * never left to read as "nothing wrong".
 */
const whyNone = (
  cause: string,
  rows: { fresh: readonly AnchoredUnresolvedRow[]; accepted: readonly AnchoredUnresolvedRow[]; all: readonly AnchoredUnresolvedRow[] },
  scope: { service?: string; package?: string },
): { error: string; known: string[]; nearest: string[] } | { note: string; next: string[] } => {
  const { service } = scope;
  const inScope = (row: AnchoredUnresolvedRow): boolean => service === undefined || row.service === service;
  const carrying = rows.fresh.filter((row) => inScope(row) && carries(row, cause));
  const apart = carrying.filter((row) => !wasMissed(row));
  if (apart.length < carrying.length && scope.package !== undefined) {
    return {
      note: `no ${cause} rows point into ${scope.package}`,
      next: [callOf('cant_follow', { service, cause })],
    };
  }
  if (apart.length > 0) {
    // Findings have a tool of their own (P95), ranked by reach; notes are only searched.
    const finding = apart.some((row) => kindOfRow(row) === 'finding');
    return {
      note: notMissedSaid(cause, apart),
      next: [finding ? callOf('findings', { kind: findingKindOf(cause), service }) : callOf('search', { query: cause, kinds: ['gaps'] })],
    };
  }
  const accepted = rows.accepted.filter((row) => inScope(row) && carries(row, cause));
  if (accepted.length > 0) {
    return {
      note: `every ${cause} row here was accepted with flowatlas accept: ${accepted.length} rows`,
      next: [callOf('search', { query: cause, kinds: ['gaps'] })],
    };
  }
  const present = rows.all.flatMap((row) => [row.reason, ...causePartsOf(row).map((part) => part.cause)]);
  const known = [...new Set([...present, ...knownCauses()])].sort();
  if (known.includes(cause)) {
    return {
      note: `no ${cause} rows${service === undefined ? '' : ` in ${service}`}`,
      next: service === undefined ? [] : [callOf('cant_follow', { cause })],
    };
  }
  return { error: `no cause named ${JSON.stringify(cause)}`, known, nearest: nearWords(known, cause, 3) };
};

/** The defaults a hint for the next page leaves out. */
const PAGE_DEFAULTS: Readonly<Record<string, unknown>> = { top: 10, samples: 3, offset: 0 };

/** What the configuration reads in place of a missing package, when the server was given one. */
const coverageOf = (ctx: ToolContext): ReadonlyMap<string, PackageCover> => {
  const { config, configDir } = ctx.handle;
  if (config === undefined || configDir === undefined) return new Map();
  try {
    return packageCoverage(config, configDir);
  } catch {
    return new Map();
  }
};

export const registerCantFollow = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'cant_follow',
    {
      title: "What the reader couldn't follow",
      description: 'Why flows stop: steps the reading could not follow, by cause and package.',
      inputSchema: {
        service: serviceInput,
        cause: z.string().optional().describe('e.g. module-not-installed'),
        package: z.string().optional(),
        top: z.number().int().min(1).max(50).default(10).describe('most causes and packages'),
        samples: z.number().int().min(0).max(20).default(3).describe('places per package'),
        ...pageInput,
      },
      outputSchema: cantFollowOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        // Demoted, matched on routes and split as doctor --unresolved does (P80).
        const split = acceptedSplitOf(db, db.allUnresolved(), readAccepted(ctx.handle.path));
        const answer = cantFollowFor(db, split.fresh, {
          top: input.top,
          samples: input.samples,
          offset: input.offset,
          ...(input.service === undefined ? {} : { service: input.service }),
          ...(input.cause === undefined ? {} : { cause: input.cause }),
          ...(input.package === undefined ? {} : { package: input.package }),
        }, coverageOf(ctx));
        const accepted = split.accepted.length === 0
          ? {}
          : { accepted: { rows: split.accepted.length, sites: split.accepted.reduce((sum, row) => sum + row.sites, 0) } };
        const note = split.problem === undefined ? {} : { note: `${describeAcceptedProblem(split.problem)}.` };
        const { notes, findings } = countsOf(
          input.service === undefined ? split.fresh : split.fresh.filter((row) => row.service === input.service),
        );
        const apart = notes + findings === 0 ? {} : { apart: { notes, findings } };
        const wire = wireCantFollow(answer, input.offset);
        if (input.cause !== undefined && wire.total.causes === 0) {
          const why = whyNone(
            input.cause,
            { fresh: split.fresh, accepted: split.accepted, all: db.allUnresolved() },
            { ...(input.service === undefined ? {} : { service: input.service }), ...(input.package === undefined ? {} : { package: input.package }) },
          );
          if ('error' in why) return why;
          return withNext({ ...wire, ...accepted, ...apart, note: [why.note, ...('note' in note ? [note.note] : [])].join(' ') }, why.next);
        }
        const args = { service: input.service, cause: input.cause, package: input.package, top: input.top, samples: input.samples };
        const page = wire.nextOffset === undefined ? [] : [callOf('cant_follow', { ...args, offset: wire.nextOffset }, PAGE_DEFAULTS)];
        return withNext({ ...wire, ...accepted, ...apart, ...note }, [...page, ...nextOf(wire, input)].slice(0, MAX_NEXT));
      }),
  );
};
