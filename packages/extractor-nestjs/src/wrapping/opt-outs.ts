import { decoratorName, evaluateExpression, lineOf, soundsLikeOptOut } from '@flowatlas/core';
import type { ClassDeclaration, Decorator, MethodDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * A flag a decorator on a handler or its class sets to `true` (P76).
 *
 * `@Public()` is, in nearly every application that has one,
 * `SetMetadata(IS_PUBLIC_KEY, true)` — written out, or behind a function of the
 * project's own, or inside `applyDecorators(...)` with other decorators. The
 * guard in front of the route reads the same key through the reflector and lets
 * the request through. Neither half says anything alone: the decorator sets a
 * key nobody may read, and the guard reads a key nobody may set. Read together
 * they say this route is open on purpose, which is the answer the route audit
 * kept getting wrong in both directions.
 */
export interface MetadataFlag {
  /** The decorator as written on the handler or the class. */
  decorator: string;
  /** The key, as its value where that could be read and as written otherwise. */
  key: string;
  /** Where the key is declared, when it is a name. */
  keyDeclaration?: TsNode;
  /** The key's string value, when it could be read. */
  keyValue?: string;
  where: 'controller' | 'route';
  file: string;
  line: number;
}

/** How many functions deep a decorator of the project's own is followed. */
const FOLLOW_LIMIT = 3;

const strip = (expr: TsNode | undefined): TsNode | undefined => {
  let current = expr;
  while (current !== undefined && (Node.isParenthesizedExpression(current) || Node.isAsExpression(current))) {
    current = current.getExpression();
  }
  return current;
};

const declarationOf = (identifier: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(identifier)) return undefined;
  const symbol = identifier.getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
};

const isProjectSource = (node: TsNode): boolean =>
  !node.getSourceFile().isInNodeModules() && !node.getSourceFile().isDeclarationFile();

/**
 * What a decorator of the project's own stands for: the one expression its
 * function answers with, or the value a `const` decorator was made from.
 */
const answerOf = (callee: TsNode): TsNode | undefined => {
  const declaration = declarationOf(callee);
  if (declaration === undefined || !isProjectSource(declaration)) return undefined;
  let fn: TsNode | undefined;
  if (Node.isFunctionDeclaration(declaration)) fn = declaration;
  else if (Node.isVariableDeclaration(declaration)) fn = strip(declaration.getInitializer());
  if (fn === undefined) return undefined;
  // `export const Public = SetMetadata(IS_PUBLIC_KEY, true)`, used as `@Public`.
  if (Node.isCallExpression(fn)) return fn;
  if (!(Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return undefined;
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return strip(body);
  const returns = body.getStatements().filter((statement) => Node.isReturnStatement(statement));
  const [only] = returns;
  return returns.length === 1 && only !== undefined && Node.isReturnStatement(only) ? strip(only.getExpression()) : undefined;
};

const keyOf = (argument: TsNode): Pick<MetadataFlag, 'key' | 'keyDeclaration' | 'keyValue'> | undefined => {
  const value = evaluateExpression(argument);
  const keyValue = value.resolved && typeof value.value === 'string' ? value.value : undefined;
  const keyDeclaration = Node.isIdentifier(argument) ? declarationOf(argument) : undefined;
  if (keyValue === undefined && keyDeclaration === undefined) return undefined;
  return {
    key: keyValue ?? argument.getText(),
    ...(keyDeclaration === undefined ? {} : { keyDeclaration }),
    ...(keyValue === undefined ? {} : { keyValue }),
  };
};

/** Every `SetMetadata(key, true)` an expression stands for, through the project's own decorators. */
const flagsIn = (expr: TsNode | undefined, depth: number): Array<Pick<MetadataFlag, 'key' | 'keyDeclaration' | 'keyValue'>> => {
  const node = strip(expr);
  if (node === undefined || depth > FOLLOW_LIMIT) return [];
  const callee = Node.isCallExpression(node) ? node.getExpression() : node;
  if (!Node.isIdentifier(callee)) return [];
  const name = callee.getText();
  if (Node.isCallExpression(node) && name === 'SetMetadata') {
    const [key, value] = node.getArguments();
    if (key === undefined || value === undefined || !Node.isTrueLiteral(strip(value) as TsNode)) return [];
    const read = keyOf(key);
    return read === undefined ? [] : [read];
  }
  if (Node.isCallExpression(node) && name === 'applyDecorators') {
    return node.getArguments().flatMap((argument) => flagsIn(argument, depth + 1));
  }
  return flagsIn(answerOf(callee), depth + 1);
};

/**
 * The opt-out flags the decorators on a handler or its class set.
 *
 * Only a flag set to the literal `true`, and only one whose decorator or key
 * says it lets a request through (`Public`, `SkipAuth`, `AllowAnonymous`): a
 * check reads `@StrictAuth()` too, and taking that for an opt-out would call
 * the one route it protects most open.
 */
export const flagsOf = (
  holder: ClassDeclaration | MethodDeclaration,
  where: MetadataFlag['where'],
  fileOf: (node: TsNode) => string,
): MetadataFlag[] => {
  const out: MetadataFlag[] = [];
  for (const decorator of holder.getDecorators()) {
    const name = decoratorName(decorator);
    for (const flag of flagsIn(decorator.getExpression(), 0)) {
      if (!soundsLikeOptOut(name, flag.key, flag.keyDeclaration === undefined ? undefined : nameOf(flag.keyDeclaration))) continue;
      out.push({ decorator: name, ...flag, where, file: fileOf(decorator), line: lineOf(decorator as Decorator) });
    }
  }
  return out;
};

const nameOf = (declaration: TsNode): string | undefined =>
  Node.isVariableDeclaration(declaration) ? declaration.getName() : undefined;

/**
 * Whether a check reads a flag: names the key's declaration, or spells its
 * value, anywhere in its class, its classes above it in this repository, or a
 * function of the project's own it calls.
 */
export class FlagReaders {
  readonly #read = new Map<ClassDeclaration, { names: Set<TsNode>; strings: Set<string> }>();

  #collect(declaration: ClassDeclaration): { names: Set<TsNode>; strings: Set<string> } {
    const known = this.#read.get(declaration);
    if (known !== undefined) return known;
    const found = { names: new Set<TsNode>(), strings: new Set<string>() };
    this.#read.set(declaration, found);
    const visit = (root: TsNode, depth: number): void => {
      root.forEachDescendant((node) => {
        if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
          found.strings.add(node.getLiteralText());
          return;
        }
        if (!Node.isIdentifier(node)) return;
        const target = declarationOf(node);
        if (target === undefined) return;
        found.names.add(target);
        // One function of the project's own, called from the check.
        if (depth === 0 && Node.isCallExpression(node.getParent()) && isProjectSource(target)) {
          if (Node.isFunctionDeclaration(target)) visit(target, depth + 1);
          else if (Node.isVariableDeclaration(target)) {
            const initializer = target.getInitializer();
            if (initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
              visit(initializer, depth + 1);
            }
          }
        }
      });
    };
    let current: ClassDeclaration | undefined = declaration;
    for (let depth = 0; current !== undefined && depth < 4; depth += 1) {
      visit(current, 0);
      const base: ClassDeclaration | undefined = current.getBaseClass();
      current = base !== undefined && isProjectSource(base) ? base : undefined;
    }
    return found;
  }

  /** Whether the check declared by `declaration` reads `flag`. */
  reads(declaration: ClassDeclaration, flag: MetadataFlag): boolean {
    const found = this.#collect(declaration);
    if (flag.keyDeclaration !== undefined && found.names.has(flag.keyDeclaration)) return true;
    return flag.keyValue !== undefined && found.strings.has(flag.keyValue);
  }
}
