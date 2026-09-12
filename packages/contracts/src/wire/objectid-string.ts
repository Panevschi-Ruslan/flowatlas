import type { TypeRefAst } from '@flowatlas/core';
import { changed, withRule, type WireRule } from './rule.js';

/** `type:bson#ObjectId` and any other package's type of that name. */
const isObjectId = (ast: TypeRefAst): boolean =>
  ast.kind === 'id' && ast.id.endsWith('#ObjectId');

const rewrite = (ast: TypeRefAst): TypeRefAst => {
  if (isObjectId(ast)) return { kind: 'primitive', name: 'string' };
  switch (ast.kind) {
    case 'array':
      return { kind: 'array', element: rewrite(ast.element) };
    case 'union':
      return { kind: 'union', members: ast.members.map(rewrite) };
    case 'intersection':
      return { kind: 'intersection', members: ast.members.map(rewrite) };
    case 'tuple':
      return { kind: 'tuple', elements: ast.elements.map(rewrite) };
    case 'generic':
      return { kind: 'generic', name: ast.name, args: ast.args.map(rewrite) };
    case 'object':
      return {
        kind: 'object',
        fields: ast.fields.map((field) => ({ ...field, type: rewrite(field.type) })),
      };
    case 'id':
      return ast.args === undefined ? ast : { kind: 'id', id: ast.id, args: ast.args.map(rewrite) };
    default:
      return ast;
  }
};

/**
 * A database identifier is a string once it is JSON.
 *
 * Not in the plan's list, and added because the real project is full of them:
 * a document store's id type carries a `toJSON` that writes it out as text, so
 * one side declares the id type and the other declares the string it actually
 * receives, and both are right. Without this every identifier on every shape is
 * reported as drift, which is most of what a report over such a project would
 * say (§13 troubleshooting, D9).
 *
 * Matched on the name alone rather than the package, because more than one
 * package declares the same type, and switched off from the configuration for a
 * project where an identifier really does cross as something else.
 */
export const objectidString: WireRule = {
  id: 'objectid-string',
  describe: "a document store's id type is serialised as a string",
  normalise: (view) => {
    const type = rewrite(view.type);
    return changed(view.type, type) ? withRule({ ...view, type }, 'objectid-string') : view;
  },
};
