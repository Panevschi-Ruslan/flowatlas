import type { Expression, TemplatePart } from './ast.js';

/**
 * Every reference written anywhere inside an expression, outermost first.
 *
 * One walk over the tree, for every reader that needs to ask what an argument
 * mentions rather than what it evaluates to: an integration whose address is a
 * string nobody can finish still names the function inside it, and a state
 * machine definition built with `jsonencode` names every function it invokes.
 * A reference is a traversal or a splat; the walk does not descend into one,
 * because the steps of `a[b].c` are part of the reference, and `b` is evaluated
 * with it.
 */
export function* referencesIn(expression: Expression): Generator<Extract<Expression, { type: 'traversal' | 'splat' }>> {
  switch (expression.type) {
    case 'traversal':
    case 'splat':
      yield expression;
      return;
    case 'template':
      yield* inParts(expression.parts);
      return;
    case 'tuple':
      for (const item of expression.items) yield* referencesIn(item);
      return;
    case 'object':
      for (const item of expression.items) {
        yield* referencesIn(item.key);
        yield* referencesIn(item.value);
      }
      return;
    case 'call':
      for (const arg of expression.args) yield* referencesIn(arg);
      return;
    case 'conditional':
      yield* referencesIn(expression.condition);
      yield* referencesIn(expression.then);
      yield* referencesIn(expression.otherwise);
      return;
    case 'binary':
      yield* referencesIn(expression.left);
      yield* referencesIn(expression.right);
      return;
    case 'unary':
      yield* referencesIn(expression.operand);
      return;
    case 'for':
      yield* referencesIn(expression.collection);
      if (expression.key !== undefined) yield* referencesIn(expression.key);
      yield* referencesIn(expression.value);
      if (expression.condition !== undefined) yield* referencesIn(expression.condition);
      return;
    case 'parens':
      yield* referencesIn(expression.inner);
      return;
    case 'literal':
    case 'variable':
      return;
  }
}

function* inParts(parts: readonly TemplatePart[]): Generator<Extract<Expression, { type: 'traversal' | 'splat' }>> {
  for (const part of parts) {
    if (part.kind === 'interpolation') yield* referencesIn(part.expression);
    else if (part.kind === 'if') {
      yield* referencesIn(part.condition);
      yield* inParts(part.then);
      yield* inParts(part.otherwise);
    } else if (part.kind === 'for') {
      yield* referencesIn(part.collection);
      yield* inParts(part.body);
    }
  }
}
