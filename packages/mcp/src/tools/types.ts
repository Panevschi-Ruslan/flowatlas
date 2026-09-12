import type { TypeEntry } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bound, commonInput, withDb, type ToolContext } from './common.js';

/** Type ids mentioned by a type's fields, so nesting can be followed. */
const referencedIds = (entry: TypeEntry): string[] => {
  const found = new Set<string>();
  for (const field of entry.fields ?? []) {
    for (const match of field.type.matchAll(/type:[^\s,;()[\]{}<>|&]+/g)) found.add(match[0]);
  }
  for (const member of entry.members ?? []) {
    for (const match of member.matchAll(/type:[^\s,;()[\]{}<>|&]+/g)) found.add(match[0]);
  }
  return [...found];
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

export const registerTypes = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_type',
    {
      title: 'Read a type',
      description:
        'The structure of a type from the registry, with the types it refers to expanded to a depth. Accepts a full type id or a bare name.',
      inputSchema: {
        type: z.string().describe('a type id such as type:orders#OrderDto, or a bare name'),
        depth: z.number().int().min(0).max(6).default(3).describe('how deep to expand nesting'),
        ...commonInput,
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { maxNodes, note } = bound(input);
        const asked = input.type.trim();

        let id = asked;
        if (!asked.startsWith('type:')) {
          const named = db.typesByName(asked);
          if (named.length === 0) return { error: `no type named ${JSON.stringify(asked)}` };
          if (named.length > 1) return { candidates: named.map((entry) => entry.id) };
          id = named[0]!.id;
        }

        const entry = db.type(id);
        if (entry === undefined) return { error: `no type with id ${JSON.stringify(id)}` };
        const expanded = expandType(db, id, input.depth, maxNodes);
        return {
          type: entry,
          nested: expanded.nested,
          ...(expanded.cut === 0
            ? {}
            : { cut: `${expanded.cut} more referenced type(s); raise maxNodes` }),
          ...(note === undefined ? {} : { note }),
        };
      }),
  );
};
