import type { DbOp } from '@flowatlas/core';

/**
 * Reading a query string.
 *
 * Some data layers put everything in a string, and the type system then says
 * nothing at all. This is the one place where text is parsed instead of types
 * being read, and it is deliberately shallow: it finds the tables a statement
 * names and what it does to them, and gives up honestly on anything else.
 */

const VERB_OPS: Array<[RegExp, DbOp]> = [
  [/^\s*(?:with\b[\s\S]*?\)\s*)?select\b/i, 'read'],
  [/^\s*insert\s+into\b/i, 'write'],
  [/^\s*update\b/i, 'write'],
  [/^\s*delete\s+from\b/i, 'delete'],
  [/^\s*truncate\b/i, 'delete'],
];

export const sqlOperation = (sql: string): DbOp | null => {
  for (const [pattern, op] of VERB_OPS) if (pattern.test(sql)) return op;
  return null;
};

/** Names introduced by a `WITH` clause. They are query-local, not tables. */
const commonTableNames = (sql: string): Set<string> => {
  const names = new Set<string>();
  const withClause = /\bwith\b([\s\S]*?)\bselect\b/i.exec(sql);
  if (withClause?.[1] === undefined) return names;
  for (const match of withClause[1].matchAll(/([A-Za-z_][\w$]*)\s+as\s*\(/gi)) {
    const name = match[1];
    if (name !== undefined) names.add(name.toLowerCase());
  }
  return names;
};

const TABLE_PATTERNS = [
  /\bfrom\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)/gi,
  /\bjoin\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)/gi,
  /\binsert\s+into\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)/gi,
  /\bupdate\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)/gi,
  /\btruncate\s+(?:table\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)/gi,
];

/** Unquotes a name and drops the schema it may be qualified by. */
const bare = (raw: string): string => {
  const unquoted = raw.replace(/["`[\]]/g, '');
  const parts = unquoted.split('.');
  return (parts[parts.length - 1] ?? unquoted).toLowerCase();
};

/**
 * Tables a statement names, in the order they appear.
 *
 * Names introduced by a `WITH` clause are excluded: they exist only for the
 * duration of the query, and reporting one as a table would invent a store that
 * is not there.
 */
export const sqlTables = (sql: string): string[] => {
  const local = commonTableNames(sql);
  const found: string[] = [];
  for (const pattern of TABLE_PATTERNS) {
    for (const match of sql.matchAll(pattern)) {
      const raw = match[1];
      if (raw === undefined) continue;
      const name = bare(raw);
      if (name === '' || local.has(name)) continue;
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
};
