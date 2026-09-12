import { createHash } from 'node:crypto';
import type { TypeEntry, TypeField, TypeRegistry } from '../model/types.js';
import { formatTypeRef, parseTypeRef, type TypeRefAst } from './type-ref.js';

/**
 * A hash of a type's shape, with its name thrown away.
 *
 * Two types that describe the same data have the same hash even under different
 * names, and renaming a type does not change it. That is the whole basis for
 * deciding later whether two services actually agree on what crosses between
 * them, so the pre-image is kept available for when a difference needs
 * explaining.
 *
 * What is deliberately not in it: field annotations. Whether a field is
 * validated or renamed on the wire is a separate question, applied on top by
 * whoever compares two hashes.
 */

export const DEFAULT_HASH_DEPTH = 3;

export interface StructuralHashOptions {
  /** How far to expand referenced types before writing a placeholder. */
  maxDepth?: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const literal = (value: string | number | boolean): string =>
  typeof value === 'string' ? `'${value}'` : String(value);

const fieldsOf = (fields: readonly TypeField[] | undefined): readonly TypeField[] =>
  [...(fields ?? [])].sort((a, b) => cmp(a.name, b.name));

/**
 * The text a hash is taken of.
 *
 * Exported because a difference between two hashes is otherwise impossible to
 * explain: comparing pre-images shows exactly which field diverged.
 */
export const normalizeStructure = (
  entry: TypeEntry,
  registry: TypeRegistry,
  options: StructuralHashOptions = {},
): string => {
  const maxDepth = options.maxDepth ?? DEFAULT_HASH_DEPTH;

  const shapeOfRef = (ast: TypeRefAst, depth: number, seen: ReadonlySet<string>): string => {
    switch (ast.kind) {
      case 'primitive':
        return ast.name;
      case 'literal':
        return literal(ast.value);
      case 'array':
        return `${shapeOfRef(ast.element, depth, seen)}[]`;
      case 'union':
        return `(${ast.members.map((member) => shapeOfRef(member, depth, seen)).sort(cmp).join('|')})`;
      case 'intersection':
        return `(${ast.members.map((member) => shapeOfRef(member, depth, seen)).sort(cmp).join('&')})`;
      case 'tuple':
        return `[${ast.elements.map((element) => shapeOfRef(element, depth, seen)).join(',')}]`;
      case 'generic':
        return `${ast.name}<${ast.args.map((argument) => shapeOfRef(argument, depth, seen)).join(',')}>`;
      case 'object':
        return `{${[...ast.fields]
          .sort((a, b) => cmp(a.name, b.name))
          .map(
            (field) =>
              `${field.name}${field.optional ? '?' : ''}:${shapeOfRef(field.type, depth, seen)}`,
          )
          .join(';')}}`;
      case 'id': {
        const key = formatTypeRef(ast);
        if (seen.has(key)) return '#cycle';
        if (depth >= maxDepth) return '#ref';
        const referenced = registry[key] ?? registry[ast.id];
        if (referenced === undefined) return '#ref';
        return shapeOfEntry(referenced, depth + 1, new Set([...seen, key]));
      }
    }
  };

  const shapeOfEntry = (target: TypeEntry, depth: number, seen: ReadonlySet<string>): string => {
    switch (target.kind) {
      // Nothing was read from it, so the only honest identity is where it came from.
      case 'external':
        return `external:${target.declaredIn}#${target.name}`;
      case 'unknown':
        return 'unknown';
      case 'enum':
        return `enum[${[...(target.members ?? [])].sort(cmp).join(',')}]`;
      case 'union':
        return `union[${[...(target.members ?? [])]
          .map((member) => shapeOfRef(parseTypeRef(member), depth, seen))
          .sort(cmp)
          .join('|')}]`;
      case 'generic':
      case 'object': {
        const prefix =
          target.kind === 'generic' ? `generic<${(target.typeParams ?? []).join(',')}>` : 'object';
        const body = fieldsOf(target.fields)
          .map(
            (field) =>
              `${field.name}${field.optional ? '?' : ''}:${shapeOfRef(parseTypeRef(field.type), depth, seen)}`,
          )
          .join(';');
        return `${prefix}{${body}}`;
      }
    }
  };

  return shapeOfEntry(entry, 0, new Set());
};

export const structuralHash = (
  entry: TypeEntry,
  registry: TypeRegistry,
  options: StructuralHashOptions = {},
): string =>
  createHash('sha256').update(normalizeStructure(entry, registry, options)).digest('hex').slice(0, 16);
