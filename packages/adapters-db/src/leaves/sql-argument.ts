import { declarationOf, evaluateExpression } from '@flowatlas/core';
import {
  Node,
  VariableDeclarationKind,
  type TemplateExpression,
  type Node as TsNode,
} from 'ts-morph';
import { SQL_VALUE_HOLE, isValuePosition } from '../sql.js';

/**
 * The SQL an argument holds, as far as the source says.
 *
 * `text` is the statement with every substitution the source leaves open written
 * as a value placeholder, or null when the argument is not a string at all as
 * far as anything can tell - a parameter, a variable assigned elsewhere.
 * `complete` says whether the text is the statement: true when every
 * substitution was a constant or sat where only a value can stand. An
 * incomplete text still says which verb opens it, and nothing more.
 */
export interface SqlArgument {
  text: string | null;
  complete: boolean;
}

const UNREAD: SqlArgument = { text: null, complete: false };

/** A substitution the source settles, as the text it puts in the statement. */
const constantOf = (node: TsNode): string | undefined => {
  const value = evaluateExpression(node);
  if (value.resolved !== true) return undefined;
  const { value: held } = value;
  return typeof held === 'string' || typeof held === 'number' ? String(held) : undefined;
};

/**
 * The template an argument is, or the one a `const` it names was written as.
 *
 * A long statement is usually written above the call and handed to it by name:
 * `const query = \`…\`; knex.raw(query, ids)`. A `const` holds the text it was
 * written with wherever it is used, so reading the template it was declared
 * with is reading the argument. A `let` could have been reassigned, and is not
 * followed, as the static reader does not follow one.
 */
const templateBehind = (argument: TsNode): TemplateExpression | undefined => {
  if (Node.isTemplateExpression(argument)) return argument;
  const declaration = declarationOf(argument);
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  const kind = declaration.getVariableStatement()?.getDeclarationKind();
  if (kind !== VariableDeclarationKind.Const) return undefined;
  const initializer = declaration.getInitializer();
  return initializer !== undefined && Node.isTemplateExpression(initializer) ? initializer : undefined;
};

/**
 * Reads the SQL an argument holds.
 *
 * A literal, a constant, or anything else the static reader settles is the
 * statement as written. A template is read one substitution at a time: a
 * constant is written in, and one that sits in a value position is written as a
 * placeholder, because what it holds cannot change which tables the statement
 * touches. One substitution anywhere else leaves the text incomplete.
 *
 * Shared by every data layer that takes its query as text, so that a statement
 * handed to one driver is read exactly as the same statement handed to another.
 */
export const readSqlArgument = (argument: TsNode | undefined): SqlArgument => {
  if (argument === undefined) return UNREAD;
  const whole = constantOf(argument);
  if (whole !== undefined) return { text: whole, complete: true };
  const template = templateBehind(argument);
  if (template === undefined) return UNREAD;

  let text = template.getHead().getLiteralText();
  let complete = true;
  for (const span of template.getTemplateSpans()) {
    const constant = constantOf(span.getExpression());
    if (constant !== undefined) text += constant;
    else {
      if (!isValuePosition(text)) complete = false;
      text += SQL_VALUE_HOLE;
    }
    text += span.getLiteral().getLiteralText();
  }
  return { text, complete };
};
