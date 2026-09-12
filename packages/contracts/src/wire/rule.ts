/**
 * What a field looks like once it is JSON, and what may change it on the way.
 *
 * A declared type is not what crosses the wire. `Date` leaves as a string, an
 * `undefined` field does not leave at all, an annotation can rename it or drop
 * it. Comparing the declarations directly would report every one of those as
 * drift, and a check that cries wolf on its first run gets switched off on its
 * second — which is why the rules are the feature, not a refinement of it.
 */
import { formatTypeRef, type TypeRefAst } from '@flowatlas/core';
import type { Side } from '../types.js';

/** One field, as the wire will carry it. */
export interface FieldView {
  /** The name in the JSON. An annotation may have renamed it. */
  name: string;
  /** The name in the source, which is what a reader will search for. */
  declaredName: string;
  /** The type in the JSON. */
  type: TypeRefAst;
  /** The reference as the extractor wrote it, before any rule. */
  declared: string;
  optional: boolean;
  /** Where optionality came from: `question`, `IsOptional`, `undefined-union`. */
  optionalBy?: string;
  /** True when the field never reaches the wire at all. */
  dropped: boolean;
  /** True when it reaches the wire but its shape is unknowable. */
  opaque: boolean;
  /** What the extractor recorded about the declaration, for the rules to read. */
  meta: Record<string, unknown>;
  /** Ids of the rules that changed anything about it. */
  rules: string[];
}

/**
 * One thing JSON does to a shape.
 *
 * Data, not a branch inside the comparator: each rule is named, testable on its
 * own, and can be switched off from the configuration when a project's wire
 * does not work that way.
 */
export interface WireRule {
  /** Stable id, reported on every finding the rule touched. */
  id: string;
  /** One sentence, for the report and for `--help`. */
  describe: string;
  /** The same view when the rule does not apply, a changed one when it does. */
  normalise(view: FieldView, side: Side): FieldView;
}

/** The view with a rule's name added, and nothing else changed. */
export const withRule = (view: FieldView, id: string): FieldView =>
  view.rules.includes(id) ? view : { ...view, rules: [...view.rules, id] };

/** Reads a string out of what the extractor recorded, when it recorded one. */
export const metaString = (view: FieldView, key: string): string | undefined => {
  const value = view.meta[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** Reads a flag out of what the extractor recorded. */
export const metaFlag = (view: FieldView, key: string): boolean => view.meta[key] === true;

/**
 * Rewrites every primitive named `from` to `to`, anywhere in a reference.
 *
 * The three serialisation rules — dates, big integers and binary — are the same
 * substitution over a different name, so they are one function called three
 * times rather than three walks of the same tree.
 */
export const rename = (ast: TypeRefAst, from: string, to: string): TypeRefAst => {
  switch (ast.kind) {
    case 'primitive':
      return ast.name === from ? { kind: 'primitive', name: to } : ast;
    case 'array':
      return { kind: 'array', element: rename(ast.element, from, to) };
    case 'union':
      return { kind: 'union', members: ast.members.map((member) => rename(member, from, to)) };
    case 'intersection':
      return {
        kind: 'intersection',
        members: ast.members.map((member) => rename(member, from, to)),
      };
    case 'tuple':
      return { kind: 'tuple', elements: ast.elements.map((element) => rename(element, from, to)) };
    case 'generic':
      return { kind: 'generic', name: ast.name, args: ast.args.map((arg) => rename(arg, from, to)) };
    case 'object':
      return {
        kind: 'object',
        fields: ast.fields.map((field) => ({ ...field, type: rename(field.type, from, to) })),
      };
    case 'id':
      return ast.args === undefined
        ? ast
        : { kind: 'id', id: ast.id, args: ast.args.map((arg) => rename(arg, from, to)) };
    default:
      return ast;
  }
};

/** True when the rename changed anything, which is what decides if it is reported. */
export const changed = (before: TypeRefAst, after: TypeRefAst): boolean =>
  formatTypeRef(before) !== formatTypeRef(after);
