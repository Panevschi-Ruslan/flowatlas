import { handedByEachCall } from '@flowatlas/core';
import type { CallExpression, NewExpression, Node as TsNode, ParameterDeclaration } from 'ts-morph';
import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';

/**
 * What a request's receiver may hold, where the compiler does not say (P301).
 *
 * `xhr.open(verb, url)` and `api.get(path)` are known for requests by the
 * type of what they are called on, or by the instance the name leads back to.
 * In a plain script the compiler often knows nothing of either: a parameter
 * has no type, `this.request` is a field the class declares as `null` and
 * fills in later, or is handed in to the constructor. What the receiver holds
 * is then read where it is given its values: a parameter by what each caller
 * hands it, one call out at a time (P312), a constructor's
 * parameter by each `new`, a field of a class or of an object by its
 * initializer and every `this.<field> = ...` its methods write, a variable by
 * its initializer and what is assigned to it. Followed until `isLeaf` says a
 * value is known for what it is, and a few steps at most.
 */

/** How many names a receiver is followed through: each caller one at a time (P312). */
const DEPTH = 6;

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current) || Node.isSatisfiesExpression(current) || Node.isTypeAssertion(current)) {
    current = current.getExpression();
  }
  return current;
};

/** The node `this` is bound to where it is written: a class or an object written in place; nothing in a plain function. */
export const thisOwnerOf = (node: TsNode): TsNode | undefined => {
  for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
    // An arrow function keeps the `this` of where it is written.
    if (Node.isArrowFunction(at)) continue;
    if (Node.isClassDeclaration(at) || Node.isClassExpression(at)) return at;
    const isMember = Node.isMethodDeclaration(at) || Node.isConstructorDeclaration(at) || Node.isGetAccessorDeclaration(at) || Node.isSetAccessorDeclaration(at) || Node.isPropertyDeclaration(at);
    if (isMember || Node.isFunctionExpression(at) || Node.isFunctionDeclaration(at)) {
      const holder = at.getParent();
      if (holder !== undefined && (Node.isClassDeclaration(holder) || Node.isClassExpression(holder))) return holder;
      if (holder !== undefined && Node.isObjectLiteralExpression(holder)) return holder;
      const object = holder !== undefined && Node.isPropertyAssignment(holder) ? holder.getParent() : undefined;
      return object !== undefined && Node.isObjectLiteralExpression(object) ? object : undefined;
    }
  }
  return undefined;
};

/** Whether a node is `this.<field>`. */
const isThisField = (node: TsNode): node is TsNode & { getName(): string } =>
  Node.isPropertyAccessExpression(node) && node.getExpression().getKind() === SyntaxKind.ThisKeyword;

/** Every value a field of a class or an object is given: where it is declared, and by each `this.<field> = ...`. */
export const fieldValues = (owner: TsNode, field: string): TsNode[] => {
  const values: TsNode[] = [];
  if (Node.isClassDeclaration(owner) || Node.isClassExpression(owner)) {
    const declared = owner.getProperty(field)?.getInitializer();
    if (declared !== undefined) values.push(declared);
    // A parameter property, `constructor(private request)`, holds what each `new` hands it.
    for (const constructor of owner.getConstructors()) {
      for (const parameter of constructor.getParameters()) if (parameter.isParameterProperty() && parameter.getName() === field) values.push(parameter.getNameNode());
    }
  }
  if (Node.isObjectLiteralExpression(owner)) {
    const property = owner.getProperty(field);
    if (property !== undefined && Node.isPropertyAssignment(property)) {
      const written = property.getInitializer();
      if (written !== undefined) values.push(written);
    } else if (property !== undefined && Node.isShorthandPropertyAssignment(property)) values.push(property.getNameNode());
  }
  for (const binary of owner.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = unwrap(binary.getLeft());
    if (isThisField(left) && left.getName() === field && thisOwnerOf(left) === owner) values.push(binary.getRight());
  }
  return values;
};

/** The calls that make an instance of a class: each `new Class(...)`. */
const constructions = (owner: TsNode): NewExpression[] => {
  if (!Node.isClassDeclaration(owner)) return [];
  const name = owner.getNameNode();
  if (name === undefined) return [];
  return name.findReferencesAsNodes().flatMap((reference) => {
    const made = reference.getParent();
    return made !== undefined && Node.isNewExpression(made) && made.getExpression() === reference ? [made] : [];
  });
};

/** What one call hands a parameter: the call, none for the parameter's own default, and the argument. */
export interface Handed {
  readonly call: CallExpression | NewExpression | undefined;
  readonly argument: TsNode;
}

/**
 * What each caller hands a parameter, one call out: through the function's
 * calls, or each `new` of a constructor's class. A caller that hands on a
 * parameter of its own is one of them (P312) - `mid(r) { start(r); r.send() }`
 * hands `start` its `r`, which is where the request is sent - and the name
 * is followed out from there, to its own callers, one level at a time.
 */
export const handedAt = (parameter: ParameterDeclaration): Handed[] => {
  const owner = parameter.getParent();
  const index = Node.isParametered(owner) ? owner.getParameters().indexOf(parameter) : -1;
  if (index < 0) return [];
  const fallback = parameter.getInitializer();
  if (Node.isConstructorDeclaration(owner)) {
    return constructions(owner.getParent()).flatMap((made) => {
      const argument = made.getArguments()[index];
      return argument === undefined ? (fallback === undefined ? [] : [{ call: made, argument: fallback }]) : [{ call: made, argument }];
    });
  }
  const calls: Handed[] = handedByEachCall(parameter);
  return fallback === undefined || calls.some((each) => each.argument === fallback) ? calls : [...calls, { call: undefined, argument: fallback }];
};

/** What each caller hands a parameter, one call out. */
export const handedTo = (parameter: ParameterDeclaration): TsNode[] => handedAt(parameter).map((each) => each.argument);

/** The parameter a value names, where it is one: what a caller was itself handed. */
export const parameterNamed = (value: TsNode): ParameterDeclaration | undefined => {
  const target = unwrap(value);
  const declaration = Node.isIdentifier(target) ? target.getSymbol()?.getDeclarations()[0] : undefined;
  return declaration !== undefined && Node.isParameterDeclaration(declaration) && Node.isIdentifier(declaration.getNameNode()) ? declaration : undefined;
};

/** Every value assigned to a variable or a parameter after it is declared, in the scope it is declared in. */
const assignedTo = (declaration: TsNode, name: TsNode): TsNode[] => {
  const symbol = name.getSymbol();
  const scope = declaration.getFirstAncestor((at) => Node.isFunctionLikeDeclaration(at) || Node.isSourceFile(at)) ?? declaration.getSourceFile();
  if (symbol === undefined) return [];
  return scope.getDescendantsOfKind(SyntaxKind.BinaryExpression).flatMap((binary) => {
    if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return [];
    const left = unwrap(binary.getLeft());
    return Node.isIdentifier(left) && left.getSymbol() === symbol ? [binary.getRight()] : [];
  });
};

/**
 * The values a receiver may hold, each one `isLeaf` knows for what it is or
 * one nothing here follows further (a call, a literal, a parameter nobody
 * calls the function with). Asked once per receiver's declaration.
 */
export const receiverValues = (isLeaf: (value: TsNode) => boolean) => {
  const byKey = new Map<TsNode | string, TsNode[]>();

  const valuesOf = (node: TsNode, depth: number, seen: Set<TsNode | string>): TsNode[] => {
    const target = unwrap(node);
    if (depth > DEPTH || isLeaf(target)) return [target];
    if (Node.isConditionalExpression(target)) return [...valuesOf(target.getWhenTrue(), depth, seen), ...valuesOf(target.getWhenFalse(), depth, seen)];
    if (Node.isBinaryExpression(target)) {
      const operator = target.getOperatorToken().getKind();
      if (operator === SyntaxKind.BarBarToken || operator === SyntaxKind.QuestionQuestionToken) return [...valuesOf(target.getLeft(), depth, seen), ...valuesOf(target.getRight(), depth, seen)];
      if (operator === SyntaxKind.AmpersandAmpersandToken) return valuesOf(target.getRight(), depth, seen);
      return [target];
    }
    const key = keyOf(target);
    if (key === undefined) return [target];
    if (seen.has(key)) return [];
    if (depth === 0 && byKey.has(key)) return byKey.get(key) ?? [];
    seen.add(key);
    const given = givenTo(target);
    const values = given === undefined ? [target] : given.flatMap((value) => valuesOf(value, depth + 1, seen));
    if (depth === 0) byKey.set(key, values);
    return values;
  };

  return (receiver: TsNode): TsNode[] => valuesOf(receiver, 0, new Set());
};

/** What a name is told apart by: its declaration, or a class's or an object's field. */
const keyOf = (target: TsNode): TsNode | string | undefined => {
  if (isThisField(target)) {
    const owner = thisOwnerOf(target);
    return owner === undefined ? undefined : `${owner.getSourceFile().getFilePath()}:${owner.getStart()}:${target.getName()}`;
  }
  if (!Node.isIdentifier(target)) return undefined;
  return target.getSymbol()?.getDeclarations()[0];
};

/** The values a name or a field is given, or nothing where it is no name that is followed. */
const givenTo = (target: TsNode): TsNode[] | undefined => {
  if (isThisField(target)) {
    const owner = thisOwnerOf(target);
    return owner === undefined ? undefined : fieldValues(owner, target.getName());
  }
  if (!Node.isIdentifier(target)) return undefined;
  const symbol = target.getSymbol();
  const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isInNodeModules() || declaration.getSourceFile().isDeclarationFile()) return undefined;
  if (Node.isParameterDeclaration(declaration)) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) return undefined;
    return [...handedTo(declaration), ...assignedTo(declaration, name)];
  }
  if (Node.isVariableDeclaration(declaration)) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) return undefined;
    const written = declaration.getInitializer();
    const constant = declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const;
    return [...(written === undefined ? [] : [written]), ...(constant ? [] : assignedTo(declaration, name))];
  }
  if (Node.isPropertyAssignment(declaration) || Node.isPropertyDeclaration(declaration)) {
    const written = declaration.getInitializer();
    return written === undefined ? [] : [written];
  }
  return undefined;
};
