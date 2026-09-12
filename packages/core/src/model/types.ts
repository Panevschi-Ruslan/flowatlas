/**
 * The type registry.
 *
 * Types are never inlined into edges: an edge carries registry ids, and the
 * structures live here once. That is what keeps a graph small enough to hand to
 * an agent.
 */
export const TYPE_KINDS = ['object', 'enum', 'union', 'generic', 'external', 'unknown'] as const;

export type TypeKind = (typeof TYPE_KINDS)[number];

export interface TypeField {
  name: string;
  /**
   * A type reference: a primitive name (`string`), a literal, a registry id
   * (`type:<repo>#<Name>`), or either of those with an `[]` suffix.
   */
  type: string;
  optional: boolean;
  meta?: Record<string, unknown>;
}

/**
 * One entry of the registry. The registry key is the id, so an entry carries no
 * id of its own.
 */
export interface TypeEntry {
  name: string;
  kind: TypeKind;
  /** `<repo>#<file>` of the declaration. */
  declaredIn: string;
  /**
   * Hash of the normalised structure: fields sorted, type names discarded.
   * Two structurally identical types share a hash even under different names.
   */
  structuralHash: string;
  fields?: TypeField[];
  /** Members of an enum or a union. */
  members?: string[];
  /** Parameter names of a generic declaration. */
  typeParams?: string[];
  meta?: Record<string, unknown>;
}

export type TypeRegistry = Record<string, TypeEntry>;
