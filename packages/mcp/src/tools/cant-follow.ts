import {
  causeLabel,
  countsOf,
  describeAcceptedProblem,
  groupCantFollow,
  packageCoverage,
  placeIdOf,
  readAccepted,
  type CantFollow,
  type CantFollowSample,
  type PackageCover,
} from '@flowatlas/core';
import { acceptedSplitOf, type AnchoredUnresolvedRow, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_NEXT, withNext } from '../query/next.js';
import { serviceInput, withDb, type ToolContext } from './common.js';

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
   * findings about the code. `search({kinds: ["gaps"]})` lists them, each with
   * its kind. Absent when there are none.
   */
  apart?: { notes: number; findings: number };
  /** Set when `accepted.json` could not be read, so nothing was left out (P80). */
  note?: string;
}


/** The breakdown, with each place said as `file:line` and the id of what it is in. */
export const cantFollowFor = (
  db: GraphDb,
  rows: readonly AnchoredUnresolvedRow[],
  options: { service?: string; cause?: string; package?: string; top: number; samples: number },
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
 * The calls that take what this answer named: the code at the first place,
 * then one cause and one package to narrow to.
 */
const nextOf = (answer: CantFollowAnswer, asked: { cause?: string; package?: string }): string[] => {
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
      description:
        'Every step the reading could not follow, grouped by why - a package that is not installed, an import that resolves to nothing, a value typed any, a callback nobody typed, a method picked by key - and by the package it points into, with a few places each. Answers "why does this flow stop" for a whole service at once. Bounded.',
      inputSchema: {
        service: serviceInput,
        cause: z.string().optional().describe('only this cause, e.g. module-not-installed'),
        package: z.string().optional().describe('only what points into this package or module'),
        top: z.number().int().min(1).max(50).default(10).describe('most causes and packages to list'),
        samples: z.number().int().min(0).max(20).default(3).describe('places listed per package under a cause'),
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        // Demoted, matched on routes and split as doctor --unresolved does (P80).
        const split = acceptedSplitOf(db, db.allUnresolved(), readAccepted(ctx.handle.path));
        const answer = cantFollowFor(db, split.fresh, {
          top: input.top,
          samples: input.samples,
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
        return withNext({ ...answer, ...accepted, ...apart, ...note }, nextOf(answer, input));
      }),
  );
};
