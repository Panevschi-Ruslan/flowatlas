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

/**
 * One name a `WITH` clause introduces: after `WITH`, `WITH RECURSIVE` or the
 * comma between two of them, with or without a list of columns, and with or
 * without `MATERIALIZED`.
 *
 * Every one of them, not only the first. The clause used to be taken as the
 * text up to the first `select`, which is inside the first definition, so the
 * second name of `WITH a AS (SELECT …), b AS (…)` and a name written with its
 * columns - `WITH input_pairs(product_id, option_id) AS (VALUES …)`, as medusa
 * writes one - were read as tables (R155).
 */
const COMMON_TABLE =
  /(?:\bwith\s+(?:recursive\s+)?|,\s*)([A-Za-z_][\w$]*)(?:\s*\([^()]*\)\s*|\s+)as\s*(?:(?:not\s+)?materialized\s*)?\(/gi;

/** Names introduced by a `WITH` clause. They are query-local, not tables. */
const commonTableNames = (sql: string): Set<string> => {
  const names = new Set<string>();
  if (!/\bwith\b/i.test(sql)) return names;
  for (const match of sql.matchAll(COMMON_TABLE)) {
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
 * What a hole the source leaves in a statement is written as, once it is known
 * to hold a value.
 *
 * The placeholder every driver's own bindings use, and not a word: the patterns
 * above take a table only where a name is written, so a `?` can never be read
 * as one.
 */
export const SQL_VALUE_HOLE = '?';

/** Text that, written just before a hole, puts a value in it and never a name. */
const VALUE_AFTER = /(?:[=<>]|\blike|\bilike|\blimit|\boffset|\bvalues)\s*$/i;

/** A parenthesised list of values: `IN (…)`, `VALUES (…)`, `ANY (…)`, `ALL (…)`. */
const VALUE_LIST_OPENER = /\b(?:in|values|any|all)\s*$/i;

/**
 * The text before the innermost parenthesis still open at the end of `sql`,
 * ignoring any written inside a quoted string.
 */
const beforeOpenParenthesis = (sql: string): string | undefined => {
  const open: number[] = [];
  let quoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (char === '(') open.push(index);
    else if (char === ')') open.pop();
  }
  const last = open.at(-1);
  return last === undefined ? undefined : sql.slice(0, last);
};

/**
 * Whether a hole written after `before` can only hold a value.
 *
 * A statement built with a template is still readable when every substitution
 * is a value: `WHERE id = ${id}` touches the table it names whatever `id` is.
 * A substitution anywhere else - after `FROM`, after `WHERE`, a whole clause, a
 * sub-select in parentheses - may name a table or hide one, and the statement is
 * then as unread as one built from nothing. So the positions are few and each is
 * one no name can stand in: inside a quoted string, after a comparison, after
 * `LIKE`, `LIMIT` or `OFFSET`, the rows after `VALUES`, and as an item of an
 * `IN (…)` or `VALUES (…)` list. Deliberately shallow, like everything else here: a value this does not
 * recognise costs a statement its tables, never gives it a wrong one.
 */
export const isValuePosition = (before: string): boolean => {
  if ((before.match(/'/g)?.length ?? 0) % 2 === 1) return true;
  if (VALUE_AFTER.test(before)) return true;
  if (!/[(,]\s*$/.test(before)) return false;
  const opener = beforeOpenParenthesis(before);
  return opener !== undefined && VALUE_LIST_OPENER.test(opener);
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
