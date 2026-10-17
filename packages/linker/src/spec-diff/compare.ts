/**
 * Two written schemas compared field by field, in the words `diff` already
 * has for a declaration that changed (`TypeFieldChange`: added, removed,
 * type, optionality).
 *
 * Both sides are documents written by the same writer, with the wire rules
 * already applied (D1), so what is compared here is what goes over the wire.
 * Component names never decide anything: a reference is followed to what it
 * names, and two shapes with the same fields under different names are the
 * same shape. A side that says it was not read (`x-flowatlas-unread`) is not
 * compared at all - a change into or out of something unread is not a change
 * anybody read (I3).
 */
import { DEFAULT_SPEC_DEPTH, SCHEMA_REF_PREFIX, UNREAD_KEY, type JsonSchema } from '../document/write-shapes.js';
import type { TypeFieldChange } from '../diff/types.js';

/** One side: the document a schema is in, so its references can be followed. */
export interface SchemaSide {
  document: Record<string, unknown>;
  schema: JsonSchema | undefined;
}

const componentsOf = (document: Record<string, unknown>): Record<string, JsonSchema> => {
  const components = (document['components'] as { schemas?: Record<string, JsonSchema> } | undefined)?.schemas;
  return components ?? {};
};

/** The schema a reference names, followed until it names no other; bounded. */
const resolve = (document: Record<string, unknown>, schema: JsonSchema | undefined): JsonSchema | undefined => {
  let found = schema;
  for (let hops = 0; hops < 16 && typeof found?.['$ref'] === 'string'; hops += 1) {
    const ref = found['$ref'] as string;
    found = ref.startsWith(SCHEMA_REF_PREFIX) ? componentsOf(document)[ref.slice(SCHEMA_REF_PREFIX.length)] : undefined;
  }
  return found;
};

const isUnread = (schema: JsonSchema | undefined): boolean => schema === undefined || typeof schema[UNREAD_KEY] === 'string';

const isObject = (schema: JsonSchema): boolean =>
  (schema['type'] === 'object' || (Array.isArray(schema['type']) && (schema['type'] as unknown[]).includes('object'))) && schema['properties'] !== undefined;

/** The one arm of `anyOf: [T, {type: null}]` that is not null; nothing for any other schema. */
const nullArm = (schema: JsonSchema): JsonSchema | undefined => {
  const arms = schema['anyOf'];
  if (!Array.isArray(arms) || arms.length !== 2) return undefined;
  const others = (arms as JsonSchema[]).filter((arm) => arm['type'] !== 'null');
  return others.length === 1 ? others[0] : undefined;
};

const literal = (value: unknown): string => (typeof value === 'string' ? `'${value}'` : String(value));

/**
 * What a schema is, in a few words, never naming a component: `string`,
 * `number | null`, `'post' | 'courier'`, `string[]`, `object`.
 */
export const schemaSaid = (document: Record<string, unknown>, schema: JsonSchema | undefined, depth = 0): string => {
  const found = resolve(document, schema);
  if (found === undefined) return 'unknown';
  if (typeof found[UNREAD_KEY] === 'string') return `unread (${found[UNREAD_KEY] as string})`;
  if (depth > 4) return '…';
  if (Array.isArray(found['enum'])) return (found['enum'] as unknown[]).map(literal).join(' | ');
  if (Object.hasOwn(found, 'const')) return literal(found['const']);
  const choice = (key: string, join: string): string | undefined =>
    Array.isArray(found[key]) ? (found[key] as JsonSchema[]).map((member) => schemaSaid(document, member, depth + 1)).join(join) : undefined;
  const composed = choice('anyOf', ' | ') ?? choice('oneOf', ' | ') ?? choice('allOf', ' & ');
  if (composed !== undefined) return composed;
  const types = Array.isArray(found['type']) ? (found['type'] as string[]) : typeof found['type'] === 'string' ? [found['type'] as string] : [];
  if (types.length === 0) return 'any';
  return types
    .map((type) => {
      if (type === 'array') return `${schemaSaid(document, found['items'] as JsonSchema | undefined, depth + 1)}[]`;
      if (type === 'object' && found['additionalProperties'] !== undefined && found['properties'] === undefined) {
        return `Record<string, ${schemaSaid(document, found['additionalProperties'] as JsonSchema, depth + 1)}>`;
      }
      return type === 'string' && typeof found['format'] === 'string' ? `string (${found['format'] as string})` : type;
    })
    .join(' | ');
};

const shown = (said: string | null): string => (said === null ? 'nothing' : `\`${said}\``);

/**
 * Every field-level difference from `base` to `head`, below `prefix`.
 *
 * Read as data flowing from the base side to the head side, as `diff` reads a
 * declaration: `added` is a field the head side has and the base side did
 * not, `optional` says whether the head side may go without it.
 */
export const compareSchemas = (base: SchemaSide, head: SchemaSide, prefix: string, depth = DEFAULT_SPEC_DEPTH): TypeFieldChange[] => {
  const changes: TypeFieldChange[] = [];
  const seen = new Set<string>();
  const walk = (b: JsonSchema | undefined, h: JsonSchema | undefined, path: string, level: number): void => {
    if (level > depth) return;
    const rb = resolve(base.document, b);
    const rh = resolve(head.document, h);
    if (isUnread(rb) || isUnread(rh)) return;
    const pair = `${String(b?.['$ref'] ?? '')}|${String(h?.['$ref'] ?? '')}|${path}`;
    if (typeof b?.['$ref'] === 'string' && typeof h?.['$ref'] === 'string') {
      // A shape that contains itself is compared once per place it is met.
      if (seen.has(pair)) return;
      seen.add(pair);
    }
    // `T | null` on both sides is `T` compared, the null said by the type
    // line only when one side lost or gained it.
    const bn = nullArm(rb as JsonSchema);
    const hn = nullArm(rh as JsonSchema);
    if (bn !== undefined && hn !== undefined) {
      walk(bn, hn, path, level);
      return;
    }
    const bs = rb as JsonSchema;
    const hs = rh as JsonSchema;
    if (isObject(bs) && isObject(hs)) {
      const bp = bs['properties'] as Record<string, JsonSchema>;
      const hp = hs['properties'] as Record<string, JsonSchema>;
      const br = new Set((bs['required'] as string[] | undefined) ?? []);
      const hr = new Set((hs['required'] as string[] | undefined) ?? []);
      const names = [...Object.keys(bp), ...Object.keys(hp).filter((name) => !Object.hasOwn(bp, name))];
      for (const name of names) {
        const at = path === '' ? name : `${path}.${name}`;
        const inBase = Object.hasOwn(bp, name);
        const inHead = Object.hasOwn(hp, name);
        if (inHead && !inBase) {
          const said = schemaSaid(head.document, hp[name]);
          changes.push({ field: at, change: 'added', optional: !hr.has(name), base: null, head: said, rule: null, message: `head has \`${at}\` as ${shown(said)}${hr.has(name) ? ' and requires it' : ''}; base did not` });
          continue;
        }
        if (inBase && !inHead) {
          const said = schemaSaid(base.document, bp[name]);
          changes.push({ field: at, change: 'removed', optional: true, base: said, head: null, rule: null, message: `base had \`${at}\` as ${shown(said)}; head has no such field` });
          continue;
        }
        if (br.has(name) !== hr.has(name)) {
          changes.push({
            field: at,
            change: 'optionality',
            optional: !hr.has(name),
            base: schemaSaid(base.document, bp[name]),
            head: schemaSaid(head.document, hp[name]),
            rule: null,
            message: hr.has(name) ? `\`${at}\` could be left out in base and is required in head` : `\`${at}\` was required in base and may be left out in head`,
          });
        }
        walk(bp[name], hp[name], at, level + 1);
      }
      return;
    }
    const arrays = bs['type'] === 'array' && hs['type'] === 'array';
    if (arrays) {
      walk(bs['items'] as JsonSchema | undefined, hs['items'] as JsonSchema | undefined, `${path}[]`, level + 1);
      return;
    }
    const was = schemaSaid(base.document, bs);
    const now = schemaSaid(head.document, hs);
    if (was !== now) {
      const at = path === '' ? 'the whole shape' : `\`${path}\``;
      changes.push({ field: path, change: 'type', optional: false, base: was, head: now, rule: null, message: `${at} was ${shown(was)} in base and is ${shown(now)} in head` });
    }
  };
  walk(base.schema, head.schema, prefix, 0);
  return changes;
};
