import { BATCH_ANSWER_PACKAGES, BATCH_FAILURES_FIELD } from '@flowatlas/aws';
import type { ExtractContext } from '@flowatlas/core';
import { Node, type Node as TsNode, type SourceFile } from 'ts-morph';
import { fileOfNode } from './shared.js';

/**
 * Whether a function handed a batch of a queue's messages answers which of
 * them failed (P389): `{ batchItemFailures }`, written in the handler or in
 * code of the repository it calls, or built by a helper made for it
 * (`BATCH_ANSWER_PACKAGES`: Powertools' batch processing, the middleware that
 * answers for a handler that throws per record).
 *
 * Three answers, because a check is made on two of them only:
 * - `returns`: the answer is written, or a helper builds it;
 * - `never`: nothing the handler runs names it, and every value it returns is
 *   one this read holds - nothing, a literal, an object written out, or what a
 *   function of the repository returns, which was read too;
 * - `unread`: it returns what code outside the repository returns, or is built
 *   in a way that names no function, and nothing is said either way.
 */
export type BatchAnswer =
  | { readonly says: 'returns'; readonly at: string }
  | { readonly says: 'never' }
  | { readonly says: 'unread'; readonly why: string };

/** The code a deployed function runs: the handler itself where one function is it, and what it is built of around it. */
export interface HandlerCode {
  /** The function handed each batch, where one is: its returns are the answer. */
  readonly fn?: TsNode;
  /** Code around it read for a helper or the field: the export's declaration, a wrapper chain. */
  readonly around: readonly TsNode[];
}

/** How deep calls into the repository's own code are followed, and how many declarations at most (I9). */
const CALL_DEPTH = 3;
const MOST_DECLARATIONS = 40;

const inRepository = (node: TsNode, ctx: ExtractContext): boolean => {
  const path = node.getSourceFile().getFilePath();
  return !path.includes('/node_modules/') && !path.endsWith('.d.ts') && !fileOfNode(node, ctx).startsWith('..');
};

/** The local names a file binds to an import of a package that builds the answer. */
const helperNames = (file: SourceFile, cache: Map<SourceFile, ReadonlySet<string>>): ReadonlySet<string> => {
  const known = cache.get(file);
  if (known !== undefined) return known;
  const names = new Set<string>();
  for (const declaration of file.getImportDeclarations()) {
    const module = declaration.getModuleSpecifierValue();
    if (!BATCH_ANSWER_PACKAGES.some((name) => module === name || module.startsWith(`${name}/`))) continue;
    const fallback = declaration.getDefaultImport();
    if (fallback !== undefined) names.add(fallback.getText());
    const namespace = declaration.getNamespaceImport();
    if (namespace !== undefined) names.add(namespace.getText());
    for (const named of declaration.getNamedImports()) names.add((named.getAliasNode() ?? named.getNameNode()).getText());
  }
  cache.set(file, names);
  return names;
};

/** The code a declaration found for a call runs, when it is code: a function, a method, a variable or member holding one. */
const bodyOf = (declaration: TsNode): TsNode | undefined => {
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration) || Node.isArrowFunction(declaration) || Node.isFunctionExpression(declaration)) {
    return declaration;
  }
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration) || Node.isPropertyDeclaration(declaration)) {
    return declaration.getInitializer();
  }
  return undefined;
};

/** The declarations of the repository a call names, through an import or an alias. */
const calledDeclarations = (callee: TsNode, ctx: ExtractContext): TsNode[] => {
  const symbol = callee.getSymbol();
  if (symbol === undefined) return [];
  const target = symbol.isAlias() ? (symbol.getAliasedSymbol() ?? symbol) : symbol;
  return target.getDeclarations().filter((declaration) => inRepository(declaration, ctx));
};

/** Whether the value a return hands back is one this read holds, or what it is not. */
const unheldValue = (value: TsNode | undefined, ctx: ExtractContext, depth = 0): string | undefined => {
  if (value === undefined || depth > CALL_DEPTH) return value === undefined ? undefined : 'a value built further than this read follows';
  if (Node.isParenthesizedExpression(value) || Node.isAsExpression(value) || Node.isNonNullExpression(value) || Node.isAwaitExpression(value) || Node.isSatisfiesExpression(value)) {
    return unheldValue(value.getExpression(), ctx, depth);
  }
  if (Node.isVoidExpression(value) || Node.isObjectLiteralExpression(value) || Node.isArrayLiteralExpression(value) || Node.isLiteralExpression(value)) return undefined;
  if (Node.isTrueLiteral(value) || Node.isFalseLiteral(value) || Node.isNullLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) || Node.isTemplateExpression(value)) return undefined;
  if (Node.isConditionalExpression(value)) return unheldValue(value.getWhenTrue(), ctx, depth + 1) ?? unheldValue(value.getWhenFalse(), ctx, depth + 1);
  if (Node.isCallExpression(value)) {
    return calledDeclarations(value.getExpression(), ctx).length > 0 ? undefined : `what ${value.getExpression().getText()} returns`;
  }
  if (Node.isIdentifier(value)) {
    if (value.getText() === 'undefined') return undefined;
    const declaration = calledDeclarations(value, ctx).find((found) => Node.isVariableDeclaration(found));
    const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    return initializer === undefined ? `the value of ${value.getText()}` : unheldValue(initializer, ctx, depth + 1);
  }
  return `${value.getText().slice(0, 60)}`;
};

/** The values a function returns itself, not those of functions written inside it. */
const returnedValues = (fn: TsNode): (TsNode | undefined)[] => {
  if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && !Node.isBlock(fn.getBody())) return [fn.getBody()];
  const values: (TsNode | undefined)[] = [];
  fn.forEachDescendant((node, traversal) => {
    if (node !== fn && Node.isFunctionLikeDeclaration(node)) {
      traversal.skip();
      return;
    }
    if (Node.isReturnStatement(node)) values.push(node.getExpression());
  });
  return values;
};

export const batchAnswerOf = (code: HandlerCode, ctx: ExtractContext): BatchAnswer => {
  const helpers = new Map<SourceFile, ReadonlySet<string>>();
  const seen = new Set<TsNode>();
  const queue: Array<{ node: TsNode; depth: number }> = [...code.around, ...(code.fn === undefined ? [] : [code.fn])].map((node) => ({ node, depth: 0 }));
  let found: string | undefined;
  let cut = false;
  while (queue.length > 0 && found === undefined && seen.size < MOST_DECLARATIONS) {
    const { node, depth } = queue.shift() as { node: TsNode; depth: number };
    if (seen.has(node)) continue;
    seen.add(node);
    const names = helperNames(node.getSourceFile(), helpers);
    const where = (at: TsNode): string => `${fileOfNode(at, ctx)}:${at.getStartLineNumber()}`;
    node.forEachDescendant((inner, traversal) => {
      if (found !== undefined) {
        traversal.stop();
        return;
      }
      const text = Node.isIdentifier(inner) ? inner.getText() : Node.isStringLiteral(inner) ? inner.getLiteralText() : undefined;
      if (text === BATCH_FAILURES_FIELD || (text !== undefined && Node.isIdentifier(inner) && names.has(text))) {
        found = where(inner);
        return;
      }
      if (Node.isCallExpression(inner)) {
        for (const declaration of calledDeclarations(inner.getExpression(), ctx)) {
          const body = bodyOf(declaration);
          if (body === undefined || seen.has(body)) continue;
          if (depth < CALL_DEPTH) queue.push({ node: body, depth: depth + 1 });
          else cut = true;
        }
      }
    });
  }
  if (found !== undefined) return { says: 'returns', at: found };
  if (cut || queue.length > 0) return { says: 'unread', why: 'the handler calls further into the repository than this read follows' };
  if (code.fn === undefined) return { says: 'unread', why: 'no one function of the repository is handed the batch' };
  for (const value of returnedValues(code.fn)) {
    const unheld = unheldValue(value, ctx);
    if (unheld !== undefined) return { says: 'unread', why: `the handler returns ${unheld}, which this read does not hold` };
  }
  return { says: 'never' };
};
