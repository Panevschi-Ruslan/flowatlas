import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { evaluateExpression } from '@flowatlas/extractor-nestjs';
import { readConfig } from './config.js';

/**
 * Where a dotted settings key comes from, when a project builds its settings
 * from the environment in a factory (P77).
 *
 * `config.get('orders.url')` names no variable of the environment. The value
 * is put together where the settings module is told how to load them:
 * `registerAs('orders', () => ({ url: process.env.ORDERS_URL ?? 'http://…' }))`,
 * or a function handed to `ConfigModule.forRoot({ load: [...] })`. Read once
 * for a repository, so a base address rooted at `orders.url` can say it is
 * the value of `ORDERS_URL`, and what the factory falls back to without it.
 */
export interface LoadedSetting {
  /** The variable of the environment the key is read from. */
  readonly variable?: string;
  /** The literal the factory falls back to where the variable is not set, or the literal it writes. */
  readonly otherwise?: string;
  /** The file the factory is written in, absolute. */
  readonly file?: string;
}

const literal = (node: TsNode): string | undefined => {
  const value = evaluateExpression(node);
  return value.resolved && typeof value.value === 'string' && value.value !== '' ? value.value : undefined;
};

/** `process.env.X`, `process.env.X ?? 'lit'`, `process.env.X || 'lit'`, or a literal. */
const leafOf = (value: TsNode): LoadedSetting | undefined => {
  const node = Node.isParenthesizedExpression(value) ? value.getExpression() : value;
  const read = readConfig(node);
  if (read !== null && read.dynamic !== true && read.source === 'process.env') return { variable: read.key };
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator !== SyntaxKind.QuestionQuestionToken && operator !== SyntaxKind.BarBarToken) return undefined;
    const left = leafOf(node.getLeft());
    if (left?.variable === undefined) return undefined;
    const otherwise = literal(node.getRight());
    return otherwise === undefined ? left : { ...left, otherwise };
  }
  const written = literal(node);
  return written === undefined ? undefined : { otherwise: written };
};

/** The object a factory answers with: an arrow's body, or its first `return`. */
const answerOf = (factory: TsNode): TsNode | undefined => {
  if (!Node.isArrowFunction(factory) && !Node.isFunctionExpression(factory) && !Node.isFunctionDeclaration(factory)) {
    return undefined;
  }
  const body = factory.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return Node.isParenthesizedExpression(body) ? body.getExpression() : body;
  return body.getDescendantsOfKind(SyntaxKind.ReturnStatement)[0]?.getExpression();
};

const keyOf = (name: TsNode): string | undefined => {
  if (Node.isIdentifier(name)) return name.getText();
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) return name.getLiteralText();
  return undefined;
};

/** Every leaf of an object a factory answers with, by its dotted key. */
const walk = (object: TsNode | undefined, prefix: readonly string[], into: Map<string, LoadedSetting>, depth = 0): void => {
  if (object === undefined || depth > 6 || !Node.isObjectLiteralExpression(object)) return;
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const key = keyOf(property.getNameNode());
    const value = property.getInitializer();
    if (key === undefined || value === undefined) continue;
    const path = [...prefix, key];
    const inner = Node.isParenthesizedExpression(value) ? value.getExpression() : value;
    if (Node.isObjectLiteralExpression(inner)) {
      walk(inner, path, into, depth + 1);
      continue;
    }
    const leaf = leafOf(inner);
    if (leaf !== undefined) into.set(path.join('.'), { ...leaf, file: property.getSourceFile().getFilePath() });
  }
};

/** The function a name in `load: [...]` stands for. */
const factoryNamed = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node)) return node;
  const declaration = node.getSymbol()?.getAliasedSymbol()?.getDeclarations()[0] ?? node.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer();
  if (Node.isExportAssignment(declaration)) return declaration.getExpression();
  return undefined;
};

/** `registerAs('orders', factory)`, with its namespace. */
const registered = (node: TsNode | undefined): { namespace: string; factory: TsNode } | undefined => {
  if (node === undefined || !Node.isCallExpression(node)) return undefined;
  const callee = node.getExpression();
  const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : '';
  if (name !== 'registerAs') return undefined;
  const [namespace, factory] = node.getArguments();
  const prefix = namespace === undefined ? undefined : literal(namespace);
  return prefix === undefined || factory === undefined ? undefined : { namespace: prefix, factory };
};

/** Every dotted key a repository's settings factories build from the environment. */
export const loadedSettings = (files: Iterable<SourceFile>): Map<string, LoadedSetting> => {
  const out = new Map<string, LoadedSetting>();
  for (const file of files) {
    // Most files set up nothing; asking every one of them for its calls is the
    // cost of a large repository, for an answer two words already rule out.
    const text = file.getFullText();
    if (!text.includes('registerAs') && !text.includes('ConfigModule')) continue;
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const named = registered(call);
      if (named !== undefined) {
        walk(answerOf(named.factory), named.namespace.split('.'), out);
        continue;
      }
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'forRoot') continue;
      if (callee.getExpression().getText() !== 'ConfigModule') continue;
      const [options] = call.getArguments();
      if (options === undefined || !Node.isObjectLiteralExpression(options)) continue;
      const load = options.getProperty('load');
      const list = load !== undefined && Node.isPropertyAssignment(load) ? load.getInitializer() : undefined;
      if (list === undefined || !Node.isArrayLiteralExpression(list)) continue;
      for (const element of list.getElements()) {
        const factory = factoryNamed(element);
        // A namespaced factory is read where it is registered, above.
        if (factory === undefined || registered(factory) !== undefined) continue;
        walk(answerOf(factory), [], out);
      }
    }
  }
  return out;
};

