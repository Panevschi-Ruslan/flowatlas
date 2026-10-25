/**
 * `get_spec` (P118): a service's routes as the OpenAPI 3.1 document
 * `flowatlas spec` writes, or its channel ends as the AsyncAPI 3.0 one, or one
 * operation of either with the schemas it uses - the shape an agent writes a
 * client or a test against, with what was not read said so in the document.
 *
 * Bounded (I9): the text is cut at `maxChars` and says so, and a cut whole
 * document lists its operations, so the next call asks for one.
 */
import {
  findOperations,
  specFragment,
  specOptionsOf,
  writeSpecs,
  type GraphDb,
  type SpecKind,
  type WrittenSpec,
} from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_NEXT, withNext } from '../query/next.js';
import { READ_ONLY, withDb, type ToolContext } from './common.js';

/** How many operation keys a cut answer lists. */
const MOST_LISTED = 40;

/** The documents of one format a service has, written now from the database. */
export const specsFor = (db: GraphDb, ctx: ToolContext, service: string, kind: SpecKind): WrittenSpec[] =>
  writeSpecs(db, [service], { ...specOptionsOf(ctx.handle.config), kind });

/** The fragment of the document that holds an entry's route, for `describe_for_prompt` (`withSpec`). */
export const specOfNode = (db: GraphDb, ctx: ToolContext, node: { id: string; repo: string; type: string; kind?: string }): { kind: SpecKind; operation: string; text: string } | undefined => {
  const kind: SpecKind = node.type === 'entry' && node.kind === 'http' ? 'openapi' : 'asyncapi';
  for (const spec of specsFor(db, ctx, node.repo, kind)) {
    const operation = spec.operations.find((each) => each.node === node.id);
    if (operation !== undefined) return { kind, operation: operation.key, text: JSON.stringify(specFragment(spec, operation), null, 2) };
  }
  return undefined;
};

const cut = (text: string, maxChars: number): { text: string; truncated?: string } =>
  text.length <= maxChars ? { text } : { text: text.slice(0, maxChars), truncated: `${maxChars} of ${text.length} characters` };

export const registerSpec = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_spec',
    {
      title: 'Read the API document',
      description: 'Routes as OpenAPI 3.1 or channels as AsyncAPI 3.0, written from the graph; path for one operation.',
      inputSchema: {
        service: z.string(),
        kind: z.enum(['openapi', 'asyncapi']).optional(),
        path: z.string().optional(),
        maxChars: z.number().int().min(500).max(100000).default(12000),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const known = db.services().map((service) => service.name);
        if (!known.includes(input.service)) {
          return { error: `no service named ${JSON.stringify(input.service)}`, services: known.sort() };
        }
        // Without a kind, a path is looked for in both documents, and the whole
        // document is the routes' where there are routes, else the channels'.
        const kinds: SpecKind[] = input.kind === undefined ? ['openapi', 'asyncapi'] : [input.kind];
        const byKind = kinds.map((kind) => specsFor(db, ctx, input.service, kind));
        const specs = input.path === undefined ? (byKind.find((found) => found.length > 0) ?? []) : byKind.flat();
        if (specs.length === 0) {
          return { error: `${input.service} has no ${input.kind === 'openapi' ? 'route' : input.kind === 'asyncapi' ? 'channel end' : 'route and no channel end'} to write` };
        }
        const kind = specs[0]!.kind;
        if (input.path !== undefined) {
          const found = specs.flatMap((spec) => findOperations(spec, input.path as string).map((operation) => ({ spec, operation })));
          if (found.length === 0) {
            return {
              error: `no operation of ${input.service} answers ${JSON.stringify(input.path)}`,
              operations: specs.flatMap((spec) => spec.operations.map((operation) => operation.key)).slice(0, MOST_LISTED),
            };
          }
          const [first] = found;
          const merged = found.length === 1 ? specFragment(first!.spec, first!.operation) : found.reduce<Record<string, unknown>>((all, { spec, operation }) => mergeInto(all, specFragment(spec, operation)), {});
          const text = cut(JSON.stringify(merged, null, 2), input.maxChars);
          return withNext(
            {
              service: input.service,
              kind: first!.spec.kind,
              operations: found.map(({ operation }) => operation.key),
              spec: text.text,
              ...(text.truncated === undefined ? {} : { truncated: text.truncated }),
            },
            found.slice(0, MAX_NEXT).map(({ operation }) => `get_flow({entry: ${JSON.stringify(operation.node)}})`),
          );
        }
        const [spec, ...others] = specs;
        const text = cut(JSON.stringify(spec!.document, null, 2), input.maxChars);
        const keys = spec!.operations.map((operation) => operation.key);
        return withNext(
          {
            service: input.service,
            kind,
            document: spec!.name,
            ...(others.length === 0 ? {} : { alsoDocuments: others.map((other) => other.name) }),
            spec: text.text,
            ...(text.truncated === undefined
              ? {}
              : { truncated: text.truncated, operations: keys.slice(0, MOST_LISTED), ...(keys.length > MOST_LISTED ? { operationsCut: keys.length - MOST_LISTED } : {}) }),
            ...(Object.keys(spec!.unread).length === 0 ? {} : { unread: spec!.unread }),
            ...(Object.keys(spec!.omitted).length === 0 ? {} : { omitted: spec!.omitted }),
          },
          text.truncated === undefined ? [] : keys.slice(0, 2).map((key) => `get_spec({service: ${JSON.stringify(input.service)}, path: ${JSON.stringify(key)}})`),
        );
      }),
  );
};

/** Two fragments of one document as one: the second's keys added where the first has none. */
const mergeInto = (into: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> => {
  for (const [key, value] of Object.entries(from)) {
    const held = into[key];
    if (held !== null && typeof held === 'object' && !Array.isArray(held) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      into[key] = mergeInto({ ...(held as Record<string, unknown>) }, value as Record<string, unknown>);
    } else if (held === undefined) into[key] = value;
  }
  return into;
};
