/**
 * What a client can read without asking a question (P96): the catalogue of
 * reasons the reading gives for a gap, and one service at a time.
 *
 * Resources are read from the same database handle the tools use, so a
 * missing or stale database is the same sentence here as there. Nothing is
 * written.
 */
import { causeOfRow, hintForCause, kindOfRow, ROW_KINDS } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { nearWords } from './query/names.js';
import { crossingsBetween } from './tools/contract.js';
import type { ToolContext } from './tools/common.js';
import { findingsOf } from './tools/findings.js';
import { startSummaryOf } from './tools/start.js';

export const REASONS_URI = 'flowatlas://reasons';
export const SERVICES_URI = 'flowatlas://services';
export const SERVICE_TEMPLATE = 'flowatlas://services/{name}';

/** Most findings a service's resource names; `findings({service})` lists the rest. */
export const SERVICE_TOP_FINDINGS = 5;

/** One reason, as the catalogue says it: the advice the CLI's `doctor` gives a row with none of its own. */
export interface ReasonHint {
  reason: string;
  hint?: string;
}

/** A reason with what kind of row it is (P81), the cause it is counted under (P75) and what to do. */
export interface ReasonEntry {
  reason: string;
  kind: string;
  cause: string;
  hint?: string;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The catalogue, every reason with its kind, cause and sentence.
 *
 * The sentences live in the CLI (`doctor`'s hints), which this package does
 * not depend on, so the CLI hands them in (D4). Without them the reasons are
 * every one core classifies, with the cause's sentence where it has one.
 */
export const reasonCatalogOf = (given?: readonly ReasonHint[]): { source: 'doctor' | 'causes'; reasons: ReasonEntry[] } => {
  const listed: readonly ReasonHint[] =
    given ?? [...ROW_KINDS.keys()].map((reason) => ({ reason }));
  const reasons = [...listed]
    .sort((a, b) => byText(a.reason, b.reason))
    .map(({ reason, hint }): ReasonEntry => {
      const { cause } = causeOfRow({ reason });
      const said = hint ?? hintForCause(cause);
      return { reason, kind: kindOfRow({ reason }), cause, ...(said === undefined ? {} : { hint: said }) };
    });
  return { source: given === undefined ? 'causes' : 'doctor', reasons };
};

const json = (uri: string, value: unknown): ReadResourceResult => ({
  contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }],
});

/** The database, or the tools' own sentence for why there is none, as a protocol error. */
const dbOf = (ctx: ToolContext): GraphDb => {
  const opened = ctx.handle.open();
  if ('error' in opened) throw new McpError(ErrorCode.InvalidRequest, opened.error);
  return opened.db;
};

/** The services the graph holds, each with the resource that reads it. */
const servicesOf = (db: GraphDb): Array<{ name: string; uri: string }> =>
  db
    .services()
    .map((service) => service.name)
    .sort(byText)
    .map((name) => ({ name, uri: `${SERVICES_URI}/${encodeURIComponent(name)}` }));

/**
 * One service: what `start_here` says of it, its crossings to and from every
 * other service with how each checks, and its top findings ranked by reach.
 */
export const serviceSummaryOf = (db: GraphDb, ctx: ToolContext, name: string) => {
  const others = db
    .services()
    .map((service) => service.name)
    .filter((other) => other !== name)
    .sort(byText);
  const findings = findingsOf(db, ctx, name).ranked;
  return {
    service: name,
    summary: startSummaryOf(db, name),
    crossings: {
      out: others.flatMap((other) => crossingsBetween(db, name, other)),
      into: others.flatMap((other) => crossingsBetween(db, other, name)),
    },
    findings: {
      total: findings.length,
      top: findings.slice(0, SERVICE_TOP_FINDINGS).map((row) => ({
        kind: row.kind,
        id: row.id,
        ...(row.loc === undefined ? {} : { loc: row.loc }),
        message: row.message,
        rank: row.rank,
      })),
    },
  };
};

export const registerResources = (server: McpServer, ctx: ToolContext, reasonCatalog?: readonly ReasonHint[]): void => {
  server.registerResource(
    'reasons',
    REASONS_URI,
    {
      title: 'Why a step was not followed',
      description: 'Every reason a row of the reading can give, with its kind (gap, note, finding), its cause and what to do about it.',
      mimeType: 'application/json',
    },
    (uri) => json(uri.href, reasonCatalogOf(reasonCatalog)),
  );
  server.registerResource(
    'services',
    SERVICES_URI,
    {
      title: 'Services',
      description: 'The services the graph holds, each with the resource that reads it.',
      mimeType: 'application/json',
    },
    (uri) => json(uri.href, { services: servicesOf(dbOf(ctx)) }),
  );
  server.registerResource(
    'service',
    new ResourceTemplate(SERVICE_TEMPLATE, {
      // Listed only once a graph exists; a client asks again after a build.
      list: () => {
        const opened = ctx.handle.open();
        if ('error' in opened) return { resources: [] };
        return {
          resources: servicesOf(opened.db).map(({ name, uri }) => ({ uri, name: `service ${name}`, mimeType: 'application/json' })),
        };
      },
      complete: {
        name: (value) => {
          const opened = ctx.handle.open();
          if ('error' in opened) return [];
          return servicesOf(opened.db)
            .map((service) => service.name)
            .filter((name) => name.startsWith(value));
        },
      },
    }),
    {
      title: 'One service',
      description: "One service's summary: counts, gaps and findings, its crossings to and from the others, its top findings.",
      mimeType: 'application/json',
    },
    (uri, variables) => {
      const db = dbOf(ctx);
      const asked = decodeURIComponent(String(variables['name'] ?? ''));
      const names = servicesOf(db).map((service) => service.name);
      if (!names.includes(asked)) {
        const near = nearWords(names, asked, 3);
        throw new McpError(
          ErrorCode.InvalidParams,
          `no service named ${JSON.stringify(asked)}${near.length === 0 ? '' : `; nearest: ${near.join(', ')}`}; ${SERVICES_URI} lists them`,
        );
      }
      return json(uri.href, serviceSummaryOf(db, ctx, asked));
    },
  );
};
