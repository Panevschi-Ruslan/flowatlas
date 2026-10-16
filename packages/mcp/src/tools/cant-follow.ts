import {
  causeLabel,
  groupCantFollow,
  loadAccepted,
  placeIdOf,
  splitAccepted,
  type CantFollow,
  type CantFollowSample,
} from '@flowatlas/core';
import type { AnchoredUnresolvedRow, GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_NEXT, withNext } from '../query/next.js';
import { serviceInput, withDb, type ToolContext } from './common.js';

/** A place, with the id of the method or function it is written in when the graph draws one. */
export interface CantFollowPlace extends CantFollowSample {
  loc: string;
  /** Id of the node the place is in, for get_source. Absent when the graph draws none. */
  id?: string;
}

export interface CantFollowAnswer extends Omit<CantFollow, 'causes'> {
  causes: Array<Omit<CantFollow['causes'][number], 'packages'> & {
    packages: Array<{ package: string | null; label: string; sites: number; samples: CantFollowPlace[] }>;
  }>;
  /** Gaps accepted with `flowatlas accept`, out of every count above. */
  accepted?: { rows: number; sites: number };
}


/** The breakdown, with each place said as `file:line` and the id of what it is in. */
export const cantFollowFor = (
  db: GraphDb,
  rows: readonly AnchoredUnresolvedRow[],
  options: { service?: string; cause?: string; package?: string; top: number; samples: number },
): CantFollowAnswer => {
  const grouped = groupCantFollow(
    rows.map((row) => ({ ...row, symbol: row.node })),
    options,
  );
  return {
    ...grouped,
    causes: grouped.causes.map((cause) => ({
      ...cause,
      packages: cause.packages.map((pkg) => ({
        package: pkg.package,
        label: causeLabel(cause.cause, pkg.package),
        sites: pkg.sites,
        samples: pkg.samples.map((sample) => {
          const id = placeIdOf(sample, (candidate) => db.node(candidate) !== undefined);
          return {
            ...sample,
            loc: `${sample.file}:${sample.line}`,
            ...(id === undefined ? {} : { id }),
          };
        }),
      })),
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
  if (asked.cause === undefined && first !== undefined) hints.push(`cant_follow({cause: ${JSON.stringify(first.cause)}})`);
  const pkg = answer.packages[0]?.package;
  if (asked.package === undefined && pkg !== undefined) {
    hints.push(`cant_follow({package: ${JSON.stringify(pkg)}})`, `search({query: ${JSON.stringify(pkg)}})`);
  }
  return hints.slice(0, MAX_NEXT);
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
        const split = splitAccepted(loadAccepted(ctx.handle.path), db.allUnresolved());
        const answer = cantFollowFor(db, split.fresh, {
          top: input.top,
          samples: input.samples,
          ...(input.service === undefined ? {} : { service: input.service }),
          ...(input.cause === undefined ? {} : { cause: input.cause }),
          ...(input.package === undefined ? {} : { package: input.package }),
        });
        const accepted = split.accepted.length === 0
          ? {}
          : { accepted: { rows: split.accepted.length, sites: split.accepted.reduce((sum, row) => sum + row.sites, 0) } };
        return withNext({ ...answer, ...accepted }, nextOf(answer, input));
      }),
  );
};
