import type { DetailLevel, TypeEntry } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withNext } from '../query/next.js';
import { bound, commonInput, nextOutput, READ_ONLY, withDb, type ToolContext } from './common.js';

/** The type ids a written type names: `type:a#B` and, in `type:x#Page<type:a#B>`, both. */
export const typeIdsIn = (written: string): string[] => [...written.matchAll(/type:[^\s,;()[\]{}<>|&]+/g)].map((match) => match[0]);

/** Type ids mentioned by a type's fields, so nesting can be followed. */
export const referencedIds = (entry: TypeEntry): string[] => {
  const found = new Set<string>();
  for (const field of entry.fields ?? []) for (const id of typeIdsIn(field.type)) found.add(id);
  for (const member of entry.members ?? []) for (const id of typeIdsIn(member)) found.add(id);
  return [...found];
};

/**
 * The type a reference means: an id as it is, or a bare name that one type
 * has; several types of that name are the candidates, never a guess.
 */
export const resolveTypeRef = (db: GraphDb, asked: string): { id: string } | { candidates: string[] } | { error: string } => {
  const trimmed = asked.trim();
  if (trimmed.startsWith('type:')) return db.type(trimmed) === undefined ? { error: `no type with id ${JSON.stringify(trimmed)}` } : { id: trimmed };
  const named = db.typesByName(trimmed);
  if (named.length === 0) return { error: `no type named ${JSON.stringify(trimmed)}` };
  if (named.length > 1) return { candidates: named.map((entry) => entry.id) };
  return { id: named[0]!.id };
};

/**
 * Everything a type refers to, down to a depth, keyed by id.
 *
 * Bounded by count as well as by depth, and it says which of the two stopped
 * it. This tool declared `maxNodes` and read nothing, so one shape referring to
 * two hundred others answered with all of them while the schema promised a
 * ceiling — and answered `detail: 3` with the note saying the level had been
 * clamped, about a knob it never applied.
 */
export const expandType = (
  db: GraphDb,
  id: string,
  depth: number,
  maxNodes: number,
): { nested: Record<string, TypeEntry>; cut: number } => {
  const nested: Record<string, TypeEntry> = {};
  let cut = 0;
  let frontier = [id];
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      const entry = db.type(current);
      if (entry === undefined) continue;
      for (const referenced of referencedIds(entry)) {
        if (referenced === id || nested[referenced] !== undefined) continue;
        const found = db.type(referenced);
        if (found === undefined) continue;
        if (Object.keys(nested).length >= maxNodes) {
          cut += 1;
          continue;
        }
        nested[referenced] = found;
        next.push(referenced);
      }
    }
    frontier = next;
  }
  return { nested, cut };
};

/**
 * A type cut to the level asked for (P93), each level a superset of the one
 * below as a node's are: at 0 its name and the names of its fields (or its
 * members), at 1 what each field is and where it is declared, at 2 its hash
 * and what the reader knows about it. A type in the registry is named by its
 * key, so `id` is said where the type is the subject and left out where the
 * key already says it.
 */
export interface TypeView {
  id?: string;
  name: string;
  kind?: string;
  declaredIn?: string;
  structuralHash?: string;
  fields?: Array<string | { name: string; type: string; optional: boolean; meta?: Record<string, unknown> }>;
  members?: string[];
  typeParams?: string[];
  meta?: Record<string, unknown>;
}

export const projectType = (entry: TypeEntry & { id?: string }, level: DetailLevel): TypeView => {
  const view: TypeView = { ...(entry.id === undefined ? {} : { id: entry.id }), name: entry.name };
  if (level <= 0) {
    if (entry.fields !== undefined && entry.fields.length > 0) view.fields = entry.fields.map((field) => field.name);
    if (entry.members !== undefined) view.members = [...entry.members];
    return view;
  }
  view.kind = entry.kind;
  view.declaredIn = entry.declaredIn;
  if (entry.fields !== undefined) {
    view.fields = entry.fields.map((field) => ({
      name: field.name,
      type: field.type,
      optional: field.optional,
      ...(level >= 2 && field.meta !== undefined ? { meta: field.meta } : {}),
    }));
  }
  if (entry.members !== undefined) view.members = [...entry.members];
  if (entry.typeParams !== undefined) view.typeParams = [...entry.typeParams];
  if (level <= 1) return view;
  view.structuralHash = entry.structuralHash;
  if (entry.meta !== undefined && Object.keys(entry.meta).length > 0) view.meta = entry.meta;
  return view;
};

const typeViewOutput = z.object({
  id: z.string().optional(),
  name: z.string(),
  kind: z.string().optional(),
  declaredIn: z.string().optional(),
  structuralHash: z.string().optional(),
  fields: z
    .array(
      z.union([
        z.string(),
        z.object({
          name: z.string(),
          type: z.string(),
          optional: z.boolean(),
          meta: z.record(z.string(), z.unknown()).optional(),
        }),
      ]),
    )
    .optional(),
  members: z.array(z.string()).optional(),
  typeParams: z.array(z.string()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'TypeView' });

/** What get_type answers: the type, what it refers to, or the types a bare name could mean. */
export const getTypeOutput = {
  type: typeViewOutput.optional(),
  nested: z.record(z.string(), typeViewOutput).optional(),
  cut: z.string().optional(),
  candidates: z.array(z.string()).optional(),
  note: z.string().optional(),
  next: nextOutput,
};

/** Without its id, which the key it is filed under says. */
const withoutId = <T extends { id?: string }>(view: T): Omit<T, 'id'> => {
  const { id: _id, ...rest } = view;
  return rest;
};

export const registerTypes = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_type',
    {
      title: 'Read a type',
      description: 'A type by id or name, with the types it refers to.',
      inputSchema: {
        type: z.string().describe('type id or name'),
        depth: z.number().int().min(0).max(6).default(3).describe('nesting to expand'),
        ...commonInput,
      },
      outputSchema: getTypeOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const resolved = resolveTypeRef(db, input.type);
        if ('error' in resolved) return resolved;
        if ('candidates' in resolved) {
          return withNext(
            { candidates: resolved.candidates },
            resolved.candidates.slice(0, 2).map((candidate) => `get_type({type: ${JSON.stringify(candidate)}})`),
          );
        }
        const id = resolved.id;
        const entry = db.type(id)!;
        // At 0 the names are the answer; what they refer to is the next question.
        const expanded = detail === 0 ? { nested: {}, cut: 0 } : expandType(db, id, input.depth, maxNodes);
        // A nested type at 1 is its name and its fields' names, enough to decide
        // whether to ask for it; at 2 it is the whole declaration.
        const nestedLevel: DetailLevel = detail >= 2 ? 2 : 0;
        const nested = Object.fromEntries(
          Object.entries(expanded.nested).map(([key, found]) => [key, withoutId(projectType(found, nestedLevel))]),
        );
        return withNext(
          {
            type: projectType({ ...entry, id }, detail),
            ...(detail === 0 ? {} : { nested }),
            ...(expanded.cut === 0
              ? {}
              : { cut: `${expanded.cut} more referenced type(s); raise maxNodes` }),
            ...(note === undefined ? {} : { note }),
          },
          // Who uses it first (P95): `find_symbol` searches names, not uses.
          [`type_usage({type: ${JSON.stringify(id)}})`, `find_symbol({query: ${JSON.stringify(entry.name)}})`],
        );
      }),
  );
};
