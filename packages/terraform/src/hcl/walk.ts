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

/**
 * Every expression written inside one, itself first (P304): unlike
 * `referencesIn`, the walk goes on into a reference - its source and the key
 * of each index step - so `local.stages[terraform.workspace]` holds the
 * workspace it is looked up by.
 */
export function* expressionsIn(expression: Expression): Generator<Expression> {
  yield expression;
  switch (expression.type) {
    case 'traversal':
    case 'splat':
      yield* expressionsIn(expression.source);
      for (const step of expression.steps) if (step.kind === 'index') yield* expressionsIn(step.key);
      return;
    case 'template':
      yield* expressionsInParts(expression.parts);
      return;
    case 'tuple':
      for (const item of expression.items) yield* expressionsIn(item);
      return;
    case 'object':
      for (const item of expression.items) {
        yield* expressionsIn(item.key);
        yield* expressionsIn(item.value);
      }
      return;
    case 'call':
      for (const arg of expression.args) yield* expressionsIn(arg);
      return;
    case 'conditional':
      yield* expressionsIn(expression.condition);
      yield* expressionsIn(expression.then);
      yield* expressionsIn(expression.otherwise);
      return;
    case 'binary':
      yield* expressionsIn(expression.left);
      yield* expressionsIn(expression.right);
      return;
    case 'unary':
      yield* expressionsIn(expression.operand);
      return;
    case 'for':
      yield* expressionsIn(expression.collection);
      if (expression.key !== undefined) yield* expressionsIn(expression.key);
      yield* expressionsIn(expression.value);
      if (expression.condition !== undefined) yield* expressionsIn(expression.condition);
      return;
    case 'parens':
      yield* expressionsIn(expression.inner);
      return;
    case 'literal':
    case 'variable':
      return;
  }
}

function* expressionsInParts(parts: readonly TemplatePart[]): Generator<Expression> {
  for (const part of parts) {
    if (part.kind === 'interpolation') yield* expressionsIn(part.expression);
    else if (part.kind === 'if') {
      yield* expressionsIn(part.condition);
      yield* expressionsInParts(part.then);
      yield* expressionsInParts(part.otherwise);
    } else if (part.kind === 'for') {
      yield* expressionsIn(part.collection);
      yield* expressionsInParts(part.body);
    }
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
