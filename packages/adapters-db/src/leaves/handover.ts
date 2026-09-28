import { declarationOf, resolveTypeOrigin, type TypeOrigin } from '@flowatlas/core';
import { Node, SyntaxKind, type Node as TsNode } from 'ts-morph';
import { isWithin, type Handover } from '../descriptors/index.js';
import { moduleImportedFrom, statedTypeName } from './stated.js';

/**
 * The data layer a receiver was handed, when it came out of a described handover.
 *
 * `manager.getKnex()({ il: 'inventory_level' }).select('reserved_quantity')` is a
 * knex query, and the only thing that says so is the call two steps down the
 * chain: `getKnex()` on a MikroORM manager. With the ORM installed and its types
 * published the checker follows that call into `knex` and nothing here is asked.
 * Where it cannot - a clone with nothing installed, or a workspace whose own
 * packages resolve to a build that was never run - the receiver has no type at
 * all, and the step the checker would have taken is a fact `handovers` records.
 *
 * So this walks down from the receiver to the call that made it, and asks one
 * question of what it finds: is this a described method, called on something a
 * described package declares? Everything on the way down is a shape rather than
 * a guess:
 *
 * - a call made on a call, which is a link of a builder's chain: `.where(…)` is
 *   made on whatever `.select(…)` returned, and the chain is one builder;
 * - a builder invoked, `knex('orders')` or `getKnex()('orders')`, which is the
 *   builder it was invoked on;
 * - a name bound once to an unannotated initialiser, `const knex = …getKnex()`,
 *   which is that initialiser. An annotated binding is not followed: it states
 *   its own type, and reading that is `statedOrigin`'s work;
 * - `a ?? b` and `a || b`, which are whichever side was handed over: a
 *   transaction's builder when there is one and the manager's when not is one
 *   builder either way.
 *
 * `await` ends the walk, because what a query resolves to is rows, not the
 * builder, and so does anything else: the walk says nothing rather than guess.
 */
export const handedOver = (
  receiver: TsNode,
  described: readonly Handover[],
): Handover | undefined => (described.length === 0 ? undefined : walk(receiver, described, 0));

/**
 * The origin a handed-over receiver has: the library the handover names and
 * nothing more.
 *
 * Shaped like the checker's answer so that the descriptor lookup, the locators
 * and the table reading downstream stay the one mechanism they are. No
 * declaration and no type argument, because the source states neither for the
 * value itself.
 */
export const handedOverOrigin = (
  receiver: TsNode,
  described: readonly Handover[],
): TypeOrigin | null => {
  const handover = handedOver(receiver, described);
  if (handover === undefined) return null;
  const { package: pkg, type } = handover.yields;
  return { package: pkg, typeName: type, typeArgs: [], isLocal: false };
};

/** How far down a receiver is walked: the longest chain a real query was seen to be. */
const MOST_STEPS = 24;

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
};

const FALLBACKS = new Set([SyntaxKind.QuestionQuestionToken, SyntaxKind.BarBarToken]);

const walk = (
  start: TsNode | undefined,
  described: readonly Handover[],
  steps: number,
): Handover | undefined => {
  let current = start;
  for (let step = steps; current !== undefined && step < MOST_STEPS; step += 1) {
    const node = unwrap(current);
    if (Node.isCallExpression(node)) {
      const callee = unwrap(node.getExpression());
      if (Node.isPropertyAccessExpression(callee)) {
        const found = handoverAt(callee.getName(), callee.getExpression(), described);
        if (found !== undefined) return found;
        current = callee.getExpression();
      } else current = callee;
      continue;
    }
    if (Node.isBinaryExpression(node) && FALLBACKS.has(node.getOperatorToken().getKind())) {
      return (
        walk(node.getRight(), described, step + 1) ?? walk(node.getLeft(), described, step + 1)
      );
    }
    if (Node.isIdentifier(node)) {
      const declaration = declarationOf(node);
      if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
      if (declaration.getTypeNode() !== undefined) return undefined;
      current = declaration.getInitializer();
      continue;
    }
    return undefined;
  }
  return undefined;
};

/** The handover a call of `method` on `holder` is, if it is one. */
const handoverAt = (
  method: string,
  holder: TsNode,
  described: readonly Handover[],
): Handover | undefined => {
  const candidates = described.filter((handover) => handover.method === method);
  if (candidates.length === 0) return undefined;
  const modules = holderModules(holder);
  return candidates.find((handover) =>
    modules.some((module) => handover.holders.some((holder) => isWithin(module, holder))),
  );
};

/**
 * Every module the holder's type can be said to come from.
 *
 * The checker's answer where it has one, which is a package; and what the source
 * writes, which is the module the type's name was imported from. Both, because
 * they answer different repositories: an installed one whose manager resolves,
 * and one where it does not and the import statement is all there is.
 */
const holderModules = (holder: TsNode): string[] => {
  const modules: string[] = [];
  const resolved = resolveTypeOrigin(holder)?.package;
  if (resolved != null) modules.push(resolved);
  const name = writtenTypeName(holder, 0);
  const imported = name === undefined ? undefined : moduleImportedFrom(name);
  if (imported !== undefined) modules.push(imported);
  return modules;
};

/** The name a written type is known by: `SqlEntityManager` in `SqlEntityManager<D>`. */
const headOf = (written: TsNode | undefined): TsNode | undefined => {
  if (written === undefined) return undefined;
  return Node.isIdentifier(written)
    ? written
    : written.getFirstDescendantByKind(SyntaxKind.Identifier);
};

/**
 * The name of the type the source writes for a holder.
 *
 * A cast or an annotation where there is one, the annotation read exactly as
 * `statedOrigin` reads it. And
 * where the holder was produced by a call that states the type it wants in a
 * type argument - `this.getActiveManager<SqlEntityManager>(context)`, which is
 * how a repository base hands out the manager for the transaction it is in -
 * that argument. It is the only place such a repository writes the manager's
 * type down, and it is read here and nowhere else: the answer is only ever used
 * to ask whether the described method was called on a described holder, so it
 * takes the type argument *and* the handover together to produce anything, and
 * no other reading of a receiver is changed by it.
 */
const writtenTypeName = (holder: TsNode, depth: number): TsNode | undefined => {
  if (depth > 4) return undefined;
  // A cast states the type outright - `(context.manager ?? fallback) as
  // SqlEntityManager` - and is asked before anything unwraps it.
  if (Node.isAsExpression(holder) || Node.isTypeAssertion(holder)) {
    return headOf(holder.getTypeNode());
  }
  if (Node.isParenthesizedExpression(holder) || Node.isNonNullExpression(holder)) {
    return writtenTypeName(holder.getExpression(), depth + 1);
  }
  if (Node.isCallExpression(holder)) return headOf(holder.getTypeArguments()[0]);
  const declaration = declarationOf(holder);
  if (declaration === undefined) return undefined;
  const stated = statedTypeName(declaration);
  if (stated !== undefined) return stated;
  const initializer = Node.isVariableDeclaration(declaration)
    ? declaration.getInitializer()
    : undefined;
  return initializer === undefined ? undefined : writtenTypeName(initializer, depth + 1);
};
