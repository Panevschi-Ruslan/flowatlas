/**
 * A document's schemas, turned into registry entries and type references.
 *
 * The tool already has one way of saying what a shape is — an entry in the type
 * registry, and a reference string for everything written out in place — and a
 * document is a second source for facts of exactly that kind. Nothing new is
 * modelled here; this file only says how JSON Schema spells what the registry
 * already holds, and it says it as two lookup tables and a walk.
 *
 * What a document describes is JSON, which is the one respect in which it is a
 * better witness than source: a repository declares `Date` and the wire rules
 * have to work out that a string arrives, whereas a document says `string`
 * with `format: date-time` and means it. So a format is never turned back into
 * the TypeScript type somebody would have written; the wire form is the fact.
 */
import { structuralHash, type TypeEntry, type TypeField, type TypeRegistry } from '@flowatlas/core';
import type { JsonSchemaNode } from './schema.js';

/**
 * What each JSON Schema scalar is called in a type reference.
 *
 * `integer` collapses to `number` because JSON has one numeric type and the
 * registry follows JSON here; a receiver declaring `number` and a document
 * declaring `integer` are not in disagreement about anything that can happen on
 * the wire, and reporting them as such would be noise on every identifier.
 */
const PRIMITIVE_OF: Record<string, string> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  null: 'null',
};

/** Where a component schema is named, in the only form this reader follows. */
const COMPONENT_PREFIX = '#/components/schemas/';

/** A reference that claims nothing, so nothing downstream pretends it does. */
const UNREADABLE = 'unknown';

/** What this reader is handed once and threads through every shape it reads. */
export interface ShapeContext {
  /** Service name, which is the repo half of every id produced here. */
  service: string;
  /** `<service>#<document>`, recorded on every entry as where it was declared. */
  declaredIn: string;
  registry: TypeRegistry;
}

const literalOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

/** The name a `$ref` points at, when it points into the components this reads. */
const componentName = (ref: string): string | undefined =>
  ref.startsWith(COMPONENT_PREFIX) ? ref.slice(COMPONENT_PREFIX.length) : undefined;

export const typeIdOf = (service: string, name: string): string => `type:${service}#${name}`;

/**
 * A name for a shape written out in the middle of an operation.
 *
 * A document may declare a body inline rather than under `components`, and the
 * registry holds shapes by name. The name is built from the operation and the
 * part it plays, so two inline bodies never collide and a reader looking at
 * `type:billing#createInvoiceBody` can see where it came from without being
 * told.
 */
export const inlineName = (operation: string, role: string): string => `${operation}${role}`;

const objectFieldsOf = (
  schema: JsonSchemaNode,
  context: ShapeContext,
  name: string,
): TypeField[] => {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, property]) => ({
    name: key,
    type: refOf(property, context, `${name}${key.charAt(0).toUpperCase()}${key.slice(1)}`),
    optional: !required.has(key),
  }));
};

/**
 * One entry put into the registry under a name, and its id handed back.
 *
 * Registering rather than inlining is what lets `contracts` compare a declared
 * shape the same way it compares a read one: the comparison resolves an id
 * through the registry and has no way of knowing, or needing to know, which
 * kind of source filled it in.
 */
const register = (name: string, entry: Omit<TypeEntry, 'structuralHash'>, context: ShapeContext): string => {
  const id = typeIdOf(context.service, name);
  // Already there: a component read up front, or a second operation reaching
  // the same inline name. Registering again would be the same entry twice and
  // the second one would win for no reason.
  if (context.registry[id] === undefined) context.registry[id] = { ...entry, structuralHash: '' };
  return id;
};

/**
 * What a schema is, as a type reference.
 *
 * The order of the cases is the order JSON Schema settles them in: a reference
 * first, then the compositions, then the enumerations, then the shapes, then
 * the scalars. `nullable` is applied last because it widens whatever came out.
 */
export const refOf = (
  schema: JsonSchemaNode | undefined,
  context: ShapeContext,
  name: string,
): string => {
  if (schema === undefined) return UNREADABLE;
  const inner = bareRefOf(schema, context, name);
  // A nullable field carries a `null` the receiving side really does read, so
  // it is part of the reference rather than a note about it.
  return schema.nullable === true && inner !== UNREADABLE ? `${inner} | null` : inner;
};

const bareRefOf = (schema: JsonSchemaNode, context: ShapeContext, name: string): string => {
  if (typeof schema.$ref === 'string') {
    const target = componentName(schema.$ref);
    // A reference out of this document, or into a part of it this does not
    // read. Saying `unknown` is the whole of what is known about it, and the
    // comparison then declines to judge rather than inventing a disagreement.
    return target === undefined ? UNREADABLE : typeIdOf(context.service, target);
  }

  const composed = compositionOf(schema, context, name);
  if (composed !== undefined) return composed;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const members = schema.enum.map(literalOf);
    if (members.every((member): member is string => member !== undefined)) {
      return members.join(' | ');
    }
  }

  const kind = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (kind === 'array') return `${refOf(schema.items, context, `${name}Item`)}[]`;

  if (kind === 'object' || schema.properties !== undefined) {
    // A shape with no properties says only that an object arrives. `object` is
    // among the references the contract check reads as claiming nothing, which
    // is exactly right: there is nothing here to compare field by field.
    if (schema.properties === undefined) return 'object';
    return register(
      name,
      {
        name,
        kind: 'object',
        declaredIn: context.declaredIn,
        fields: objectFieldsOf(schema, context, name),
        meta: { declaredBy: 'openapi' },
      },
      context,
    );
  }

  const primitive = kind === undefined ? undefined : PRIMITIVE_OF[kind];
  return primitive ?? UNREADABLE;
};

/**
 * `allOf`, `oneOf` and `anyOf`, which the reference grammar already spells.
 *
 * A generated document splits one shape across `allOf` far more often than a
 * handwritten one does, and an intersection is what the registry calls that.
 * `oneOf` and `anyOf` are both a choice as far as anything downstream is
 * concerned: the comparison walks a choice arm by arm and says which arm a
 * disagreement is about, and neither keyword changes what may arrive.
 */
const compositionOf = (
  schema: JsonSchemaNode,
  context: ShapeContext,
  name: string,
): string | undefined => {
  const compositions: ReadonlyArray<[readonly JsonSchemaNode[] | undefined, string]> = [
    [schema.allOf, ' & '],
    [schema.oneOf, ' | '],
    [schema.anyOf, ' | '],
  ];
  for (const [members, join] of compositions) {
    if (members === undefined || members.length === 0) continue;
    const refs = members.map((member, index) => refOf(member, context, `${name}${index + 1}`));
    if (refs.some((ref) => ref === UNREADABLE)) return UNREADABLE;
    return refs.length === 1 ? (refs[0] as string) : refs.join(join);
  }
  return undefined;
};

/**
 * Every schema under `components`, registered before any operation is read.
 *
 * Up front because a document refers to its components from anywhere, and a
 * reference resolved before its target existed would be a registry id nothing
 * holds — which the contract check reports as a type it could not find, on a
 * document that was perfectly complete.
 */
export const registerComponents = (
  schemas: Record<string, JsonSchemaNode>,
  context: ShapeContext,
): void => {
  for (const [name, schema] of Object.entries(schemas)) {
    const id = typeIdOf(context.service, name);
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      const members = schema.enum.map(literalOf).filter((member): member is string => member !== undefined);
      context.registry[id] = {
        name,
        kind: 'enum',
        declaredIn: context.declaredIn,
        structuralHash: '',
        members,
        meta: { declaredBy: 'openapi' },
      };
      continue;
    }
    if (schema.properties !== undefined) {
      context.registry[id] = {
        name,
        kind: 'object',
        declaredIn: context.declaredIn,
        structuralHash: '',
        fields: objectFieldsOf(schema, context, name),
        meta: { declaredBy: 'openapi' },
      };
      continue;
    }
    // A component that is an alias for something else — a bare string, an array
    // of another component, a composition. It is recorded as a shape nothing
    // here can open rather than as an empty object, because an empty object is
    // a claim that it has no fields and this is a statement that it was not
    // read as a shape at all.
    context.registry[id] = {
      name,
      kind: 'unknown',
      declaredIn: context.declaredIn,
      structuralHash: '',
      meta: { declaredBy: 'openapi', alias: refOf(schema, context, `${name}Alias`) },
    };
  }
};

/**
 * The hashes, once every entry a hash could reach is in the registry.
 *
 * A structural hash expands the shapes a field refers to, so one taken while
 * the registry was half filled would hash a placeholder where a shape was going
 * to be — and two services that agree would come out with different hashes and
 * be reported as drift.
 */
export const sealHashes = (registry: TypeRegistry, declaredIn: string): void => {
  for (const entry of Object.values(registry)) {
    if (entry.declaredIn !== declaredIn) continue;
    entry.structuralHash = structuralHash(entry, registry);
  }
};
