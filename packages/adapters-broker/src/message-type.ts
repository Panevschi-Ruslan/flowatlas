import { resolve as resolvePath, sep } from 'node:path';
import {
  DISCRIMINATOR_FIELDS,
  DISCRIMINATOR_META,
  SELECTED_BY_META,
  SELECTION_UNREAD_META,
  SELECTS_META,
  SELECTS_OTHERS_META,
  SELECTION_DIFFERS_META,
  definePass,
  evaluateExpression,
  findMethod,
  functionOf,
  isDiscriminatorField,
  methodNamedOn,
  namedFunction,
  recordEntriesOf,
  subscriptionsOf,
  UNREACHED_META,
  type ClassMethod,
  type DiscriminatorField,
  type ExtractorPass,
  type GraphBuilder,
  type GraphEdge,
  type GraphNode,
  type NamedFunction,
  type Selection,
  type SelectionVia,
  type Unresolved,
} from '@flowatlas/core';
import {
  Node,
  SyntaxKind,
  type ArrayLiteralExpression,
  type ArrowFunction,
  type CallExpression,
  type ClassDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Node as TsNode,
  type Project,
  type Statement,
  type Type,
} from 'ts-morph';
import { functionBehind } from './constructed.js';

/**
 * The types of message a channel carries, read at both ends (P358).
 *
 * One channel often carries many kinds of message told apart by a string field
 * - `{ type: 'ORDER_READY', … }` - and one consumer takes all of them, choosing
 * what to do by the field. This reads the field at each end: the value a
 * publish writes into its payload, and the values a consumer's handler chooses
 * on - a `switch`, an `if`, a guard that returns early, a record of handlers
 * looked up by the type - with the handler each choice runs, one call deep.
 * The linker turns both into the type's own node; here they are recorded on
 * the producer and the consumer they belong to.
 *
 * Whatever has a type and is not read is said, with why, never dropped. A
 * consumer that never reads the field at all takes every type alike - it
 * forwards them, or does one thing with each - and records nothing: that is
 * not a choice of type, and drawing it as one would claim a handler for every
 * type it passes on.
 */

// ---------------------------------------------------------------------------
// Values

/** Past the wrappers that change nothing about a value. */
const peel = (node: TsNode): TsNode => {
  let current = node;
  for (let step = 0; step < 8; step += 1) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isAwaitExpression(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
  return current;
};

/** The string values a type allows: one literal, a union of literals, an enum's members. */
const literalsOfType = (type: Type): string[] | undefined => {
  const one = (each: Type): string | undefined => {
    if (each.isStringLiteral() || each.isEnumLiteral()) {
      const value = each.getLiteralValue();
      return typeof value === 'string' ? value : undefined;
    }
    return undefined;
  };
  const single = one(type);
  if (single !== undefined) return [single];
  if (type.isUnion()) {
    const values = type.getUnionTypes().map(one);
    return values.every((value): value is string => value !== undefined) ? [...new Set(values)] : undefined;
  }
  return undefined;
};

/**
 * The values an expression may be, as the code states them: a literal, a
 * constant, an enum member or a member of a constant object, and past that,
 * what its type allows. `exact` when the code names one value, or a list the
 * code itself wrote out.
 */
const valuesOf = (expression: TsNode): { values: string[]; exact: boolean } | undefined => {
  const evaluated = evaluateExpression(expression);
  if (evaluated.resolved && typeof evaluated.value === 'string') return { values: [evaluated.value], exact: true };
  if (evaluated.resolved && Array.isArray(evaluated.value) && evaluated.value.every((each) => typeof each === 'string')) {
    return { values: evaluated.value as string[], exact: true };
  }
  const typed = literalsOfType(expression.getType());
  return typed === undefined ? undefined : { values: typed, exact: typed.length === 1 };
};

/** Short text of an expression for a row. */
const textOf = (node: TsNode): string => node.getText().replace(/\s+/g, ' ').slice(0, 60);

/** Whether a declaration is the repository's own code rather than a package's. */
const isOwnCode = (declaration: TsNode, repoDir: string): boolean => {
  const file = declaration.getSourceFile();
  const path = file.getFilePath();
  return !file.isDeclarationFile() && !path.includes(`${sep}node_modules${sep}`) && !path.includes('/node_modules/') && resolvePath(path).startsWith(resolvePath(repoDir));
};

// ---------------------------------------------------------------------------
// The send

/** The type a publish writes into its payload, or why it was not read; nothing where the payload has no type. */
export type MessageTypeReading =
  | { readonly types: readonly string[]; readonly field: DiscriminatorField }
  | { readonly field: DiscriminatorField; readonly why: string };

const MOST_HOPS = 4;

/** Two readings of the branches of one value, as one. */
const joined = (readings: readonly (MessageTypeReading | undefined)[]): MessageTypeReading | undefined => {
  const present = readings.filter((each): each is MessageTypeReading => each !== undefined);
  const [first] = present;
  if (first === undefined) return undefined;
  const unread = present.find((each) => 'why' in each);
  if (unread !== undefined) return unread;
  return { field: first.field, types: [...new Set(present.flatMap((each) => ('types' in each ? each.types : [])))].sort() };
};

/** What the payload's type says its discriminator is, where the code did not write it. */
const fromType = (expression: TsNode): MessageTypeReading | undefined => {
  const type = expression.getType();
  if (type.isAny() || type.isUnknown()) return undefined;
  for (const field of DISCRIMINATOR_FIELDS) {
    const property = type.getProperty(field);
    if (property === undefined) continue;
    const held = property.getTypeAtLocation(expression);
    const values = literalsOfType(held);
    if (values !== undefined && values.length === 1) return { field, types: values };
    if (values !== undefined) {
      return {
        field,
        why: `${textOf(expression)} may be any of ${values.length} types (${values.slice(0, 4).join(', ')}${values.length > 4 ? ', …' : ''}); which one is decided where it is built, not here.`,
      };
    }
    if (held.isString()) return { field, why: `The ${field} of ${textOf(expression)} is a string worked out when the code runs.` };
    return undefined;
  }
  return undefined;
};

/** The function a call runs, where it is the repository's own and its answers can be read. */
const calledFunction = (call: CallExpression): FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | undefined => {
  const callee = peel(call.getExpression());
  const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  let symbol = name.getSymbol();
  if (symbol?.isAlias() === true) symbol = symbol.getAliasedSymbol() ?? symbol;
  const declaration = symbol?.getDeclarations()[0];
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile()) return undefined;
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    if (initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) return initializer;
  }
  return undefined;
};

/** What a function answers, each place it answers. */
const answersOf = (fn: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression): TsNode[] => {
  const body = fn.getBody();
  if (body === undefined) return [];
  if (!Node.isBlock(body)) return [body];
  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => nearestFunction(statement) === fn)
    .flatMap((statement) => {
      const value = statement.getExpression();
      return value === undefined ? [] : [value];
    });
};

/**
 * The type a payload carries, as written where it is sent (P358): the
 * discriminator of an object written in place, a variable or constant holding
 * one, an enum member or a constant's member as the value, a helper of the
 * repository's own whose answer is written out, and past those what the
 * payload's type fixes. Nothing where the payload has no discriminator.
 */
export const readMessageType = (payload: TsNode | undefined, depth = 0): MessageTypeReading | undefined => {
  if (payload === undefined || depth > MOST_HOPS) return undefined;
  const value = peel(payload);
  if (Node.isCallExpression(value)) {
    const callee = peel(value.getExpression());
    const [first] = value.getArguments();
    // A message sent as text or bytes is the object written into them.
    if (first !== undefined && Node.isPropertyAccessExpression(callee) && ['JSON.stringify', 'Buffer.from'].includes(callee.getText())) {
      return readMessageType(first, depth + 1);
    }
    const fn = calledFunction(value);
    if (fn !== undefined) {
      const read = joined(answersOf(fn).map((answer) => readMessageType(answer, depth + 1)));
      if (read !== undefined) return read;
    }
    return fromType(value);
  }
  if (Node.isConditionalExpression(value)) {
    return joined([readMessageType(value.getWhenTrue(), depth + 1), readMessageType(value.getWhenFalse(), depth + 1)]);
  }
  if (Node.isObjectLiteralExpression(value)) {
    for (const field of DISCRIMINATOR_FIELDS) {
      const property = value.getProperty(field);
      if (property === undefined) continue;
      const written = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : undefined;
      if (written === undefined) continue;
      const values = valuesOf(written);
      if (values !== undefined && values.exact) return { field, types: values.values };
      if (values !== undefined) {
        return { field, why: `The ${field} is ${textOf(written)}, which may be any of ${values.values.length} types (${values.values.slice(0, 4).join(', ')}${values.values.length > 4 ? ', …' : ''}); which one is decided where it is called.` };
      }
      return { field, why: `The ${field} is ${textOf(written)}, a value worked out when the code runs.` };
    }
    // A spread of an object that carries the type, the last one written winning.
    for (const property of [...value.getProperties()].reverse()) {
      if (!Node.isSpreadAssignment(property)) continue;
      const read = readMessageType(property.getExpression(), depth + 1);
      if (read !== undefined) return read;
    }
    return undefined;
  }
  if (Node.isIdentifier(value)) {
    const declaration = value.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      const read = initializer === undefined ? undefined : readMessageType(initializer, depth + 1);
      if (read !== undefined && 'types' in read) return read;
      const typed = fromType(value);
      return typed ?? read;
    }
  }
  return fromType(value);
};

// ---------------------------------------------------------------------------
// The choice

type FunctionLike = MethodDeclaration | FunctionDeclaration | ArrowFunction | FunctionExpression;

const isFunctionLike = (node: TsNode): node is FunctionLike =>
  Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node);

/** The function a node is written in, closest first. */
const nearestFunction = (node: TsNode): TsNode | undefined =>
  node.getFirstAncestor(
    (each) => isFunctionLike(each) || Node.isConstructorDeclaration(each) || Node.isGetAccessorDeclaration(each) || Node.isSetAccessorDeclaration(each),
  );

/** The function a selection's branch runs: a method or a function of the repository's own, or a node an earlier pass drew. */
export type ChosenHandler =
  // `argument`: which of the call's arguments hands the message on, where one does (P369).
  | { readonly kind: 'method'; readonly method: ClassMethod; readonly argument?: number }
  | { readonly kind: 'function'; readonly fn: NamedFunction; readonly argument?: number }
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'self' };

export interface ReadSelection {
  readonly type: string;
  readonly field: DiscriminatorField;
  readonly via: SelectionVia;
  readonly line: number;
  readonly handler: ChosenHandler;
  readonly heuristic?: true;
  /** The file the choice is written in, relative to the repository, where it is not the handler's own (P369). */
  readonly file?: string;
}

export interface SelectionReading {
  readonly selections: readonly ReadSelection[];
  readonly unread: readonly { readonly line: number; readonly text: string; readonly why: string; readonly file?: string }[];
  /** A default branch that hands every other type on the same way. */
  readonly others: boolean;
  /** Read as a predicate (P362): the types the function answers `true` for, or `false` for where `positive` is false. */
  readonly predicate?: { readonly field: DiscriminatorField; readonly values: readonly string[]; readonly positive: boolean };
  /**
   * Where the function chooses nothing and hands the message to a function of
   * the repository's own (P369): that function, and the argument it is handed
   * the message in, so the choice it makes is read as this one's.
   */
  readonly handsTo?: ChosenHandler;
}

/** How a function is read for the types it chooses, beyond as a handler of its own. */
export interface SelectionOptions {
  /** Read as a predicate - the function an rxjs `filter` is handed - for the types it lets through (P362). */
  readonly predicate?: true;
  /**
   * Types already chosen before the function runs - by the operators in front of a
   * subscription's callback (P362): where the function chooses nothing itself,
   * each is handled by what it calls; where it chooses, only these are kept.
   */
  readonly given?: { readonly field: DiscriminatorField; readonly values: readonly string[]; readonly line: number };
  /** Which parameter the message is handed in: the first by default (P369). */
  readonly parameter?: number;
  /**
   * Every parameter that can hold a message is one (P369): a function read for
   * the calls it makes under a choice, whatever parameter it was handed the
   * message in - a route's body beside its parameters.
   */
  readonly everyParameter?: true;
}

/** What a reading of one handler can ask the repository about. */
export interface SelectionLookup {
  readonly repoDir: string;
  /** A call the earlier passes resolved, by its line in the function: the node it reaches. */
  calledAt?(line: number): string | undefined;
  /** Methods marked by a decorator naming one value, across the repository. */
  decorated?(): readonly { readonly value: string; readonly method: ClassMethod }[];
}

/** Fields a message is wrapped in, on its way to a handler: an event's `data`, a request's `body`. */
const ENVELOPES = new Set(['data', 'payload', 'body', 'detail', 'message']);

/** The classes a set of values the code writes out is made with. */
const SET_CLASSES: ReadonlySet<string> = new Set(['Set', 'ReadonlySet']);

/** Whether a parameter's type can be a message: anything but a plain value - a string, a number, a flag. */
const mayHoldMessage = (type: Type): boolean =>
  type.isAny() || type.isUnknown() || type.isObject() || type.isUnion() || type.isIntersection() || type.isTypeParameter();

/**
 * The types a handler takes by the declared type of the parameter it is handed
 * the message in (P369): `handle(event: OrderReady)` where `OrderReady` says
 * `type: 'ORDER_READY'`, or a union of literals there. Nothing where the
 * parameter is a union of messages - the whole set a channel carries, taken
 * alike - nor where the discriminator is a plain string.
 */
export const parameterSelection = (fn: FunctionLike, index = 0): { field: DiscriminatorField; values: string[]; line: number } | undefined => {
  const parameter = fn.getParameters()[index];
  if (parameter === undefined || parameter.getTypeNode() === undefined) return undefined;
  const type = parameter.getType().getNonNullableType();
  if (type.isAny() || type.isUnknown() || type.isUnion() || !type.isObject()) return undefined;
  for (const field of DISCRIMINATOR_FIELDS) {
    const property = type.getProperty(field);
    if (property === undefined) continue;
    const values = literalsOfType(property.getTypeAtLocation(parameter));
    return values === undefined || values.length === 0 ? undefined : { field, values, line: parameter.getStartLineNumber() };
  }
  return undefined;
};

/** Whether a type can hold a discriminator's value. */
const stringish = (type: Type): boolean =>
  type.isAny() || type.isUnknown() || type.isString() || type.isStringLiteral() || type.isEnumLiteral() || type.isEnum() || literalsOfType(type) !== undefined;

const exits = (statement: Statement): boolean => {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement) || Node.isContinueStatement(statement)) return true;
  if (Node.isBlock(statement)) {
    const last = statement.getStatements().at(-1);
    return last !== undefined && exits(last);
  }
  return false;
};

const EQUAL = new Set([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken]);
const UNEQUAL = new Set([SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.ExclamationEqualsToken]);

type Condition =
  | { readonly field: DiscriminatorField; readonly values: string[]; readonly positive: boolean }
  | { readonly unread: string };

/**
 * The types a consumer's handler chooses on, and the handler each choice runs
 * (P358): a `switch`, an `if` and the `else if`s after it, a guard returning
 * early unless the type is one, a record of handlers looked up by the type,
 * and a decorator naming the type on a method the handler finds through
 * something filled when the code runs. The handler a branch runs is the first
 * call into the repository's own code that is handed the message, or failing
 * that the first such call at all; a branch that calls nothing of its own is
 * handled where it is written.
 */
export const readSelections = (fn: FunctionLike, owner: ClassDeclaration | undefined, lookup: SelectionLookup, options: SelectionOptions = {}): SelectionReading => {
  const messages = new Set<TsNode>();
  const discriminators = new Map<TsNode, DiscriminatorField>();
  const selections: ReadSelection[] = [];
  const unread: { line: number; text: string; why: string }[] = [];
  let others = false;

  const declarationOf = (node: TsNode): TsNode | undefined => (Node.isIdentifier(node) ? node.getSymbol()?.getDeclarations()[0] : undefined);

  const isMessage = (expression: TsNode): boolean => {
    const node = peel(expression);
    if (Node.isIdentifier(node)) {
      const declaration = declarationOf(node);
      return declaration !== undefined && messages.has(declaration);
    }
    if (Node.isCallExpression(node) && node.getExpression().getText() === 'JSON.parse') {
      const [text] = node.getArguments();
      if (text === undefined) return false;
      const inner = peel(text);
      return isMessage(inner) || (Node.isPropertyAccessExpression(inner) && isMessage(inner.getExpression()));
    }
    if (Node.isPropertyAccessExpression(node) && ENVELOPES.has(node.getName()) && isMessage(node.getExpression())) {
      return !stringish(node.getType()) || node.getType().isAny();
    }
    return false;
  };

  /** The discriminator an expression reads off the message, where it reads one. */
  const fieldRead = (expression: TsNode): DiscriminatorField | undefined => {
    const node = peel(expression);
    if (Node.isIdentifier(node)) {
      const declaration = declarationOf(node);
      return declaration === undefined ? undefined : discriminators.get(declaration);
    }
    const [holder, name] = Node.isPropertyAccessExpression(node)
      ? [node.getExpression(), node.getName()]
      : Node.isElementAccessExpression(node)
        ? [node.getExpression(), (() => {
            const argument = node.getArgumentExpression();
            return argument !== undefined && (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) ? argument.getLiteralValue() : undefined;
          })()]
        : [undefined, undefined];
    if (holder === undefined || name === undefined || !isDiscriminatorField(name)) return undefined;
    if (!isMessage(holder)) return undefined;
    return stringish(node.getType()) ? name : undefined;
  };

  const own = (node: TsNode, within: TsNode): boolean => nearestFunction(node) === within;

  const takeBindings = (pattern: TsNode, fromMessage: boolean): void => {
    if (!Node.isObjectBindingPattern(pattern) || !fromMessage) return;
    for (const element of pattern.getElements()) {
      const key = element.getPropertyNameNode()?.getText() ?? element.getName();
      if (isDiscriminatorField(key)) discriminators.set(element, key);
      else if (ENVELOPES.has(key)) messages.add(element);
    }
  };

  const parameters = fn.getParameters();
  const seeds =
    options.everyParameter === true
      ? parameters.filter((parameter) => mayHoldMessage(parameter.getType()))
      : parameters.slice(options.parameter ?? 0, (options.parameter ?? 0) + 1);
  for (const seed of seeds) {
    const name = seed.getNameNode();
    if (Node.isIdentifier(name)) messages.add(seed);
    else takeBindings(name, true);
  }
  // Aliases, in the order they are written: a parsed copy, an envelope's
  // content, the discriminator held in a local of its own.
  const locals = fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((each) => own(each, fn));
  for (let round = 0; round < 2; round += 1) {
    for (const local of locals) {
      const initializer = local.getInitializer();
      if (initializer === undefined) continue;
      const name = local.getNameNode();
      if (Node.isIdentifier(name)) {
        if (isMessage(initializer)) messages.add(local);
        else {
          const field = fieldRead(initializer);
          if (field !== undefined) discriminators.set(local, field);
        }
      } else takeBindings(name, isMessage(initializer));
    }
  }
  // A function that never reads the type chooses nothing - unless the types were chosen in front of it.
  const readsType = messages.size > 0 || discriminators.size > 0;
  if (!readsType && options.given === undefined) return { selections, unread, others };

  const passesMessage = (call: CallExpression): boolean =>
    call.getArguments().some((argument) =>
      [argument, ...argument.getDescendants()].some((each) => isMessage(each) || fieldRead(each) !== undefined),
    );

  const resolveCall = (call: CallExpression, within: TsNode): ChosenHandler | undefined => {
    const callee = peel(call.getExpression());
    if (Node.isPropertyAccessExpression(callee) && Node.isThisExpression(peel(callee.getExpression())) && owner !== undefined) {
      const found = methodNamedOn(owner, callee.getName()) ?? findMethod(owner, callee.getName()).method;
      if (found !== undefined && isOwnCode(found, lookup.repoDir)) return { kind: 'method', method: found };
    }
    const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : Node.isIdentifier(callee) ? callee : undefined;
    let symbol = name?.getSymbol();
    if (symbol?.isAlias() === true) symbol = symbol.getAliasedSymbol() ?? symbol;
    const declaration = symbol?.getDeclarations()[0];
    if (declaration !== undefined && isOwnCode(declaration, lookup.repoDir)) {
      if (Node.isMethodDeclaration(declaration) && declaration.getBody() !== undefined) return { kind: 'method', method: declaration };
      if (Node.isPropertyDeclaration(declaration) && functionOf(declaration) !== undefined) return { kind: 'method', method: declaration };
      const fnNamed = namedFunction(declaration);
      if (fnNamed !== undefined && nearestFunction(declaration) === undefined) return { kind: 'function', fn: fnNamed };
    }
    // A call the earlier passes resolved through injection or an interface, by its line.
    if (within === fn && lookup.calledAt !== undefined) {
      const id = lookup.calledAt(call.getStartLineNumber());
      if (id !== undefined) return { kind: 'node', id };
    }
    return undefined;
  };

  /** Which of a call's arguments hands the message on, where one does. */
  const messageArgument = (call: CallExpression): number | undefined => {
    const index = call.getArguments().findIndex((argument) => [argument, ...argument.getDescendants()].some((each) => isMessage(each)));
    return index < 0 ? undefined : index;
  };

  /**
   * Whether a call runs code of another class than the one read (P374): a
   * method another class declares, or a call an earlier pass resolved through
   * injection or an interface.
   */
  const intoAnotherClass = (resolved: ChosenHandler): boolean =>
    resolved.kind === 'node' || (resolved.kind === 'method' && classAround(resolved.method) !== owner);

  /** Whether a call hands on the message itself (or its wrapped content), not a part of it. */
  const handsWhole = (call: CallExpression): boolean => call.getArguments().some((argument) => isMessage(argument));

  /**
   * The handler a branch runs: the first own call handed the message, else the
   * first own call, else the branch itself. A call into another class is a
   * handler only when it is handed the message itself (P374): a branch that
   * shows a toast with one of its fields (`this.toast.show(evt.text)`) is
   * handled where it is written, never by the toast, which every other caller
   * of it would then make look reached.
   */
  const handlerIn = (statements: readonly TsNode[], within: TsNode): ChosenHandler => {
    const calls = statements
      .flatMap((statement) => [statement, ...statement.getDescendants()])
      .filter((node): node is CallExpression => Node.isCallExpression(node) && own(node, within));
    let fallback: ChosenHandler | undefined;
    for (const call of calls) {
      const resolved = resolveCall(call, within);
      if (resolved === undefined) continue;
      const foreign = intoAnotherClass(resolved);
      if (foreign ? handsWhole(call) : passesMessage(call)) {
        const argument = messageArgument(call);
        return argument === undefined || (resolved.kind !== 'method' && resolved.kind !== 'function') ? resolved : { ...resolved, argument };
      }
      if (!foreign) fallback ??= resolved;
    }
    return fallback ?? { kind: 'self' };
  };

  const add = (values: readonly string[], field: DiscriminatorField, via: SelectionVia, at: TsNode, handler: ChosenHandler, heuristic = false): void => {
    for (const type of values) {
      selections.push({ type, field, via, line: at.getStartLineNumber(), handler, ...(heuristic ? { heuristic: true as const } : {}) });
    }
  };

  const valueSide = (left: TsNode, right: TsNode): { field: DiscriminatorField; value: TsNode } | undefined => {
    const leftField = fieldRead(left);
    if (leftField !== undefined) return { field: leftField, value: right };
    const rightField = fieldRead(right);
    return rightField === undefined ? undefined : { field: rightField, value: left };
  };

  /**
   * The strings a list or a set the code writes out holds: written in place, or
   * held in a constant of the module or a field of the class - `['A', 'B']`,
   * `new Set(['A', 'B'])`, `new Set<string>([…])`, `['A'] as const` (P362).
   */
  const listedValues = (expression: TsNode, depth = 0): string[] | undefined => {
    if (depth > 3) return undefined;
    const node = peel(expression);
    const strings = (value: TsNode): string[] | undefined => {
      const evaluated = evaluateExpression(value);
      return evaluated.resolved && Array.isArray(evaluated.value) && evaluated.value.every((each) => typeof each === 'string') ? (evaluated.value as string[]) : undefined;
    };
    if (Node.isNewExpression(node) && SET_CLASSES.has(node.getExpression().getText())) {
      const [list] = node.getArguments();
      return list === undefined ? undefined : (strings(peel(list)) ?? listedValues(list, depth + 1));
    }
    const direct = strings(node);
    if (direct !== undefined) return direct;
    let held: TsNode | undefined;
    if (Node.isIdentifier(node)) {
      const declaration = node.getSymbol()?.getDeclarations()[0];
      if (declaration !== undefined && Node.isVariableDeclaration(declaration)) held = declaration.getInitializer();
    } else if (Node.isPropertyAccessExpression(node)) {
      const holder = peel(node.getExpression());
      const declaration = node.getNameNode().getSymbol()?.getDeclarations()[0];
      if ((Node.isThisExpression(holder) || Node.isIdentifier(holder)) && declaration !== undefined && Node.isPropertyDeclaration(declaration)) held = declaration.getInitializer();
    }
    return held === undefined ? undefined : listedValues(held, depth + 1);
  };

  const condition = (expression: TsNode): Condition | undefined => {
    const node = peel(expression);
    if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
      const inner = condition(node.getOperand());
      return inner === undefined || 'unread' in inner ? inner : { ...inner, positive: !inner.positive };
    }
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getKind();
      if (EQUAL.has(operator) || UNEQUAL.has(operator)) {
        const side = valueSide(node.getLeft(), node.getRight());
        if (side === undefined) return undefined;
        const values = valuesOf(side.value);
        if (values === undefined || !values.exact) return { unread: `${textOf(node)} compares the type with ${textOf(side.value)}, which is not a value the code states.` };
        return { field: side.field, values: values.values, positive: EQUAL.has(operator) };
      }
      if (operator === SyntaxKind.BarBarToken || operator === SyntaxKind.AmpersandAmpersandToken) {
        const left = condition(node.getLeft());
        const right = condition(node.getRight());
        if (left !== undefined && 'unread' in left) return left;
        if (right !== undefined && 'unread' in right) return right;
        if (left === undefined || right === undefined) {
          // One side about something else: an `&&` with it narrows nothing about the type.
          const one = left ?? right;
          return operator === SyntaxKind.AmpersandAmpersandToken && one !== undefined && one.positive ? one : undefined;
        }
        const sameWay = left.positive === right.positive && left.field === right.field;
        if (!sameWay) return undefined;
        // `a || b` widens a positive test, `a && b` a negative one.
        if ((operator === SyntaxKind.BarBarToken) === left.positive) {
          return { field: left.field, values: [...new Set([...left.values, ...right.values])], positive: left.positive };
        }
        return undefined;
      }
      return undefined;
    }
    // `['A', 'B'].includes(event.type)`, `LIST.includes(event.type)`, `SET.has(event.type)` (P362)
    if (Node.isCallExpression(node)) {
      const callee = peel(node.getExpression());
      const [argument] = node.getArguments();
      if (Node.isPropertyAccessExpression(callee) && (callee.getName() === 'includes' || callee.getName() === 'has') && argument !== undefined) {
        const field = fieldRead(argument);
        if (field === undefined) return undefined;
        const listed = listedValues(callee.getExpression());
        if (listed !== undefined) return { field, values: listed, positive: true };
        return { unread: `${textOf(node)} tests the type against a ${callee.getName() === 'has' ? 'set' : 'list'} the code does not write out.` };
      }
    }
    return undefined;
  };

  const noteUnread = (at: TsNode, why: string): void => {
    unread.push({ line: at.getStartLineNumber(), text: textOf(at), why });
  };

  /** The handler a record's entry runs. */
  const handlerOfEntry = (value: TsNode | undefined): ChosenHandler | undefined => {
    if (value === undefined) return undefined;
    const node = peel(value);
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const [parameter] = node.getParameters();
      if (parameter !== undefined) {
        const name = parameter.getNameNode();
        if (Node.isIdentifier(name)) messages.add(parameter);
        else takeBindings(name, true);
      }
      const body = node.getBody();
      return handlerIn(Node.isBlock(body) ? body.getStatements() : [body], node);
    }
    const behind = functionBehind(node, owner, new Map());
    if (behind === undefined) return undefined;
    return behind.kind === 'method' ? { kind: 'method', method: behind.method } : { kind: 'function', fn: behind.fn };
  };

  /** A record a class field holds, written where the field is declared or in the constructor. */
  const fieldRecord = (record: TsNode): TsNode | undefined => {
    const node = peel(record);
    if (!Node.isPropertyAccessExpression(node) || !Node.isThisExpression(peel(node.getExpression())) || owner === undefined) return undefined;
    const property = owner.getProperty(node.getName());
    return property?.getInitializer();
  };

  /** The entries of a record or a map written out, by key. */
  const entriesOf = (record: TsNode): { entries: { key: string; value?: TsNode }[] } | { why: string } => {
    const written = fieldRecord(record) ?? record;
    const node = peel(written);
    if (Node.isNewExpression(node) && node.getExpression().getText() === 'Map') {
      const [list] = node.getArguments();
      if (list === undefined || !Node.isArrayLiteralExpression(peel(list))) return { why: `${textOf(record)} is a map filled when the code runs.` };
      const entries: { key: string; value?: TsNode }[] = [];
      for (const pair of (peel(list) as ArrayLiteralExpression).getElements()) {
        const tuple = peel(pair);
        if (!Node.isArrayLiteralExpression(tuple)) return { why: `${textOf(pair)} is not an entry written out.` };
        const [key, value] = tuple.getElements();
        const keyValue = key === undefined ? undefined : valuesOf(key);
        if (keyValue === undefined || !keyValue.exact) return { why: `${textOf(pair)} has a key worked out when the code runs.` };
        for (const each of keyValue.values) entries.push({ key: each, ...(value === undefined ? {} : { value }) });
      }
      return { entries };
    }
    const read = recordEntriesOf(written);
    return 'why' in read ? { why: read.why } : { entries: [...read.entries] };
  };

  /** Whether a lookup's answer is run: called where it is looked up, or through the local it is put in. */
  const answerRun = (lookupNode: TsNode): boolean => {
    let node: TsNode = lookupNode;
    let parent = node.getParent();
    while (parent !== undefined && (Node.isParenthesizedExpression(parent) || Node.isNonNullExpression(parent) || Node.isAsExpression(parent))) {
      node = parent;
      parent = parent.getParent();
    }
    if (parent === undefined) return false;
    if (Node.isCallExpression(parent) && parent.getExpression() === node) return true;
    // `handlers[type]?.call(this, event)`, `.apply`, `.bind`.
    if (Node.isPropertyAccessExpression(parent) && ['call', 'apply'].includes(parent.getName())) return true;
    if (Node.isVariableDeclaration(parent)) {
      const name = parent.getNameNode();
      if (!Node.isIdentifier(name)) return false;
      return fn
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .some((call) => {
          const callee = peel(call.getExpression());
          return Node.isIdentifier(callee) && callee.getSymbol() === name.getSymbol();
        });
    }
    return false;
  };

  /** A record of handlers looked up by the type. */
  const readRecord = (record: TsNode, field: DiscriminatorField, at: TsNode): void => {
    const read = entriesOf(record);
    if ('why' in read) {
      noteUnread(at, `${textOf(at)} looks the handler up by the type: ${read.why}`);
      return;
    }
    const chosen = read.entries.map((entry) => ({ key: entry.key, handler: handlerOfEntry(entry.value) }));
    // A record of anything but functions is a table of values - labels, colours - and chooses no handler.
    if (chosen.length === 0 || chosen.some((entry) => entry.handler === undefined)) return;
    for (const entry of chosen) add([entry.key], field, 'map', at, entry.handler as ChosenHandler);
  };

  let decorated: readonly { value: string; method: ClassMethod }[] | undefined;
  /** A lookup through something filled when the code runs: the methods a decorator names the type on. */
  const readDecorated = (field: DiscriminatorField, read: TsNode, at: TsNode): void => {
    const admitted = literalsOfType(read.getType());
    decorated ??= lookup.decorated?.() ?? [];
    const found = admitted === undefined ? [] : decorated.filter((each) => admitted.includes(each.value));
    if (found.length === 0) {
      noteUnread(at, `${textOf(at)} looks the handler up by the type in something filled when the code runs, and no method names the type in a decorator.`);
      return;
    }
    for (const each of found) add([each.value], field, 'decorator', at, { kind: 'method', method: each.method }, true);
  };

  if (options.predicate === true) {
    const body = fn.getBody();
    const statements = body !== undefined && Node.isBlock(body) ? body.getStatements() : [];
    const [only] = statements;
    const answer = body === undefined ? undefined : !Node.isBlock(body) ? body : statements.length === 1 && only !== undefined && Node.isReturnStatement(only) ? only.getExpression() : undefined;
    const test = answer === undefined || !readsType ? undefined : condition(answer);
    if (test !== undefined && 'unread' in test) noteUnread(answer as TsNode, test.unread);
    return { selections, unread, others, ...(test === undefined || 'unread' in test ? {} : { predicate: { field: test.field, values: test.values, positive: test.positive } }) };
  }

  for (const node of readsType ? fn.getDescendants() : []) {
    if (!own(node, fn)) continue;
    if (Node.isSwitchStatement(node)) {
      const field = fieldRead(node.getExpression());
      if (field === undefined) continue;
      let pending: string[] = [];
      for (const clause of node.getCaseBlock().getClauses()) {
        const statements = clause.getStatements();
        if (Node.isCaseClause(clause)) {
          const values = valuesOf(clause.getExpression());
          if (values === undefined || !values.exact) noteUnread(clause, `case ${textOf(clause.getExpression())} is not a value the code states.`);
          else pending.push(...values.values);
          if (statements.length === 0) continue;
          add(pending, field, 'switch', clause, handlerIn(statements, fn));
          pending = [];
        } else {
          if (statements.length > 0 && handlerIn(statements, fn).kind !== 'self') others = true;
          pending = [];
        }
      }
      continue;
    }
    if (Node.isIfStatement(node)) {
      const test = condition(node.getExpression());
      if (test === undefined) continue;
      if ('unread' in test) {
        noteUnread(node.getExpression(), test.unread);
        continue;
      }
      const then = node.getThenStatement();
      const otherwise = node.getElseStatement();
      if (test.positive) {
        add(test.values, test.field, 'if', node, handlerIn([then], fn));
        continue;
      }
      if (exits(then)) {
        // `if (type !== 'A') return; …` - everything after the guard handles A.
        const block = node.getParent();
        const statements: Statement[] = Node.isBlock(block) || Node.isSourceFile(block) ? block.getStatements() : [];
        const after = statements.slice(statements.indexOf(node) + 1);
        add(test.values, test.field, 'guard', node, handlerIn(after, fn));
        continue;
      }
      if (otherwise !== undefined) add(test.values, test.field, 'if', node, handlerIn([otherwise], fn));
      continue;
    }
    if (Node.isConditionalExpression(node)) {
      const test = condition(node.getCondition());
      if (test === undefined || 'unread' in test) continue;
      add(test.values, test.field, 'if', node, handlerIn([test.positive ? node.getWhenTrue() : node.getWhenFalse()], fn));
      continue;
    }
    if (Node.isElementAccessExpression(node)) {
      const argument = node.getArgumentExpression();
      const field = argument === undefined ? undefined : fieldRead(argument);
      if (field === undefined || !answerRun(node)) continue;
      readRecord(node.getExpression(), field, node);
      continue;
    }
    if (Node.isCallExpression(node)) {
      const [argument] = node.getArguments();
      const field = argument === undefined ? undefined : fieldRead(argument);
      if (field === undefined || argument === undefined || !answerRun(node)) continue;
      const callee = peel(node.getExpression());
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'get') {
        const read = entriesOf(callee.getExpression());
        if (!('why' in read)) {
          readRecord(callee.getExpression(), field, node);
          continue;
        }
      }
      readDecorated(field, peel(argument), node);
    }
  }
  const given = options.given;
  if (given !== undefined) {
    // Chosen in front of the function: what it chooses itself is kept where the operators let it through.
    if (selections.length > 0) return { selections: selections.filter((selection) => given.values.includes(selection.type)), unread, others };
    const body = fn.getBody();
    const statements = body === undefined ? [] : Node.isBlock(body) ? body.getStatements() : [body];
    const handler = handlerIn(statements, fn);
    for (const type of given.values) selections.push({ type, field: given.field, via: 'filter', line: given.line, handler });
    return { selections, unread, others };
  }
  if (selections.length === 0 && unread.length === 0 && messages.size > 0) {
    // Chooses nothing itself, and hands the message on to a function of the repository's own (P369).
    const body = fn.getBody();
    const statements = body === undefined ? [] : Node.isBlock(body) ? body.getStatements() : [body];
    const passed = handlerIn(statements, fn);
    if ((passed.kind === 'method' || passed.kind === 'function') && passed.argument !== undefined) return { selections, unread, others, handsTo: passed };
  }
  return { selections, unread, others };
};

// ---------------------------------------------------------------------------
// A subscription (P362)

/** A function handed over as a value: written in place, or a method of an object written in place (`{ next(evt) {…} }`). */
const handedFunction = (value: TsNode | undefined): FunctionLike | undefined => {
  if (value === undefined) return undefined;
  const node = peel(value);
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return node;
  if (Node.isObjectLiteralExpression(node)) {
    const next = node.getProperty('next');
    if (next !== undefined && Node.isMethodDeclaration(next)) return next;
    if (next !== undefined && Node.isPropertyAssignment(next)) return handedFunction(next.getInitializer());
  }
  return undefined;
};

/** The operators handed to each `pipe` between an observable and its `subscribe`, outermost last. */
const operatorsBefore = (subscribe: CallExpression): TsNode[] => {
  const operators: TsNode[][] = [];
  const callee = peel(subscribe.getExpression());
  let at: TsNode | undefined = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
  for (let step = 0; at !== undefined && step < 8; step += 1) {
    const node = peel(at);
    if (!Node.isCallExpression(node)) break;
    const inner = peel(node.getExpression());
    if (!Node.isPropertyAccessExpression(inner)) break;
    if (inner.getName() === 'pipe') operators.unshift([...node.getArguments()]);
    else if (inner.getName() !== 'asObservable') break;
    at = inner.getExpression();
  }
  return operators.flat();
};

/** The name an operator is called by: `filter(…)`, `operators.filter(…)`. */
const operatorName = (operator: TsNode): string | undefined => {
  const node = peel(operator);
  if (!Node.isCallExpression(node)) return undefined;
  const callee = peel(node.getExpression());
  return Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
};

/**
 * The types a subscription chooses (P362): the predicates of the `filter`s in
 * the `pipe` before it, each narrowing what reaches the callback, and the
 * callback read as any handler is - the types the operators let through being
 * the callback's where it chooses nothing itself. A subscription that chooses
 * nothing anywhere takes every type alike, and records nothing.
 */
export const readSubscription = (subscribe: CallExpression, owner: ClassDeclaration | undefined, lookup: SelectionLookup): SelectionReading => {
  const unread: { line: number; text: string; why: string }[] = [];
  let given: { field: DiscriminatorField; values: string[]; line: number } | undefined;
  let narrowedAway = false;
  for (const operator of operatorsBefore(subscribe)) {
    if (operatorName(operator) !== 'filter') continue;
    const predicate = handedFunction((peel(operator) as CallExpression).getArguments()[0]);
    if (predicate === undefined) continue;
    const read = readSelections(predicate, owner, lookup, { predicate: true });
    unread.push(...read.unread);
    if (read.predicate === undefined || !read.predicate.positive) continue;
    const values = [...read.predicate.values];
    if (given === undefined) given = { field: read.predicate.field, values, line: operator.getStartLineNumber() };
    else {
      given = { ...given, values: given.values.filter((value) => values.includes(value)) };
      if (given.values.length === 0) narrowedAway = true;
    }
  }
  const callback = handedFunction(subscribe.getArguments()[0]);
  if (narrowedAway) return { selections: [], unread, others: false };
  if (callback === undefined) {
    const selections: ReadSelection[] =
      given === undefined ? [] : given.values.map((type) => ({ type, field: given!.field, via: 'filter' as const, line: given!.line, handler: { kind: 'self' as const } }));
    return { selections, unread, others: false };
  }
  const read = readSelections(callback, owner, lookup, given === undefined ? {} : { given });
  return { selections: read.selections, unread: [...unread, ...read.unread], others: read.others, ...(read.handsTo === undefined ? {} : { handsTo: read.handsTo }) };
};

/**
 * What is written at a line and column of a file, where a consumer's messages
 * arrive: a function written in place (P369), the first function starting
 * there, or the `subscribe` call starting there (P362).
 */
const subscriptionAt = (
  host: MessageTypeHost,
  file: string | undefined,
  line: number,
  column: number,
): { readonly fn: FunctionLike } | { readonly subscribe: CallExpression } | undefined => {
  if (file === undefined) return undefined;
  const source = host.project.getSourceFile(resolvePath(host.repoDir, file));
  if (source === undefined) return undefined;
  let position: number;
  try {
    position = source.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
  } catch {
    return undefined;
  }
  // Every node from the token written there out to the outermost one starting there; the function or the `subscribe` among them.
  let call: CallExpression | undefined;
  for (let at = source.getDescendantAtPos(position); at !== undefined && at.getStart() === position; at = at.getParent()) {
    if (isFunctionLike(at)) return { fn: at };
    if (!Node.isCallExpression(at)) continue;
    const callee = peel(at.getExpression());
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'subscribe') call = at;
  }
  return call === undefined ? undefined : { subscribe: call };
};

/** The class a node is written in, where it is written in one. */
const classAround = (node: TsNode): ClassDeclaration | undefined => node.getFirstAncestor((each): each is ClassDeclaration => Node.isClassDeclaration(each));

/** The function a chosen handler runs, and the class it is written in. */
const functionOfHandler = (handler: ChosenHandler): { fn: FunctionLike; owner?: ClassDeclaration } | undefined => {
  if (handler.kind === 'method') {
    const fn = functionOf(handler.method);
    if (fn === undefined) return undefined;
    const owner = classAround(handler.method);
    return owner === undefined ? { fn } : { fn, owner };
  }
  if (handler.kind === 'function') {
    const declaration = handler.fn.declaration;
    const fn = isFunctionLike(declaration)
      ? declaration
      : Node.isVariableDeclaration(declaration)
        ? (() => {
            const initializer = declaration.getInitializer();
            return initializer !== undefined && isFunctionLike(initializer) ? initializer : undefined;
          })()
        : undefined;
    return fn === undefined ? undefined : { fn };
  }
  return undefined;
};

/** A handler as the one a choice runs, no longer as one to follow into. */
const withoutArgument = (handler: ChosenHandler): ChosenHandler =>
  handler.kind === 'method' ? { kind: 'method', method: handler.method } : handler.kind === 'function' ? { kind: 'function', fn: handler.fn } : handler;

/** How many functions deep a choice is followed into the handlers it hands the message to (P369). */
const MOST_NESTED = 2;

/** How many of a handler's callers are read for the choice they call it under (P369). */
const MOST_CALLERS = 8;

/**
 * A choice followed into the function it hands the message to (P369): where
 * a branch hands the message to a function of the repository's own that
 * chooses again - a guard letting two types through to a method that
 * `switch`es on them - each type is drawn onto the handler the inner choice
 * runs. A type the inner function does not choose stays with it.
 */
const followedIn = (
  selections: readonly ReadSelection[],
  lookupFor: (handler: ChosenHandler) => SelectionLookup,
  fileOf: (node: TsNode) => string,
  depth = 0,
): { selections: ReadSelection[]; unread: { line: number; text: string; why: string; file?: string }[] } => {
  if (depth >= MOST_NESTED) return { selections: [...selections], unread: [] };
  const out: ReadSelection[] = [];
  const unread: { line: number; text: string; why: string; file?: string }[] = [];
  const read = new Map<FunctionLike, SelectionReading>();
  for (const selection of selections) {
    const { handler } = selection;
    const behind = (handler.kind === 'method' || handler.kind === 'function') && handler.argument !== undefined ? functionOfHandler(handler) : undefined;
    if (behind === undefined) {
      out.push(selection);
      continue;
    }
    let inner = read.get(behind.fn);
    if (inner === undefined) {
      inner = readSelections(behind.fn, behind.owner, lookupFor(handler), { parameter: (handler as { argument: number }).argument });
      read.set(behind.fn, inner);
      const file = fileOf(behind.fn);
      unread.push(...inner.unread.map((row) => ({ ...row, file })));
    }
    const kept = inner.selections.filter((each) => each.type === selection.type);
    if (kept.length === 0) {
      out.push(selection);
      continue;
    }
    const file = fileOf(behind.fn);
    // A branch of the inner choice that calls nothing of its own is handled by the inner function itself.
    const itself = withoutArgument(handler);
    const deeper = followedIn(
      kept.map((each) => ({ ...each, file, handler: each.handler.kind === 'self' ? itself : each.handler })),
      lookupFor,
      fileOf,
      depth + 1,
    );
    out.push(...deeper.selections);
    unread.push(...deeper.unread);
  }
  return { selections: out, unread };
};

// ---------------------------------------------------------------------------
// The pass

/** What the pass needs of whichever extractor runs it: the repository, its project and its builder. */
export interface MessageTypeHost {
  readonly repo: string;
  readonly repoDir: string;
  readonly project: Project;
  readonly builder: GraphBuilder;
  /** A reader that draws no methods (a React one) leaves these out: a branch's method handler is then the branch itself. */
  methodIdOf?(declaration: ClassMethod): string | undefined;
  ensureMethodNode?(declaration: ClassMethod): GraphNode | undefined;
  functionIdOf?(fn: NamedFunction): string | undefined;
  ensureFunctionNode?(fn: NamedFunction): GraphNode | undefined;
  report(row: Unresolved): void;
}

/**
 * The function written at a place: the one whose declaration starts on that
 * line of that file, the outermost where several do. How a handler is found
 * that no id spells as `Class.method` or a module's function - a callback
 * written in place, a browser's `onmessage = (m) => …` - whichever reader drew
 * the consumer, as long as it says where the handler is written.
 */
const declarationAt = (host: MessageTypeHost, file: string | undefined, line: number | undefined): { fn: FunctionLike; owner?: ClassDeclaration } | undefined => {
  if (file === undefined || line === undefined) return undefined;
  const source = host.project.getSourceFile(resolvePath(host.repoDir, file));
  if (source === undefined) return undefined;
  const found = source.getDescendants().find((node): node is FunctionLike => isFunctionLike(node) && node.getStartLineNumber() === line);
  if (found === undefined) return undefined;
  const owner = found.getFirstAncestor((each): each is ClassDeclaration => Node.isClassDeclaration(each));
  return owner === undefined ? { fn: found } : { fn: found, owner };
};

/** The function a method or function node stands for, found by its id, or failing that by where it is written. */
const declarationOfNode = (host: MessageTypeHost, node: GraphNode): { fn: FunctionLike; owner?: ClassDeclaration } | undefined =>
  declarationById(host, node) ?? declarationAt(host, node.file, node.line);

const declarationById = (host: MessageTypeHost, node: GraphNode): { fn: FunctionLike; owner?: ClassDeclaration } | undefined => {
  if (node.type !== 'method' && node.type !== 'function') return undefined;
  const hash = node.id.indexOf('#');
  const symbol = node.id.slice(hash + 1);
  const cut = symbol.lastIndexOf(':');
  if (hash < 0 || cut < 0) return undefined;
  const file = host.project.getSourceFile(resolvePath(host.repoDir, symbol.slice(0, cut)));
  if (file === undefined) return undefined;
  const name = symbol.slice(cut + 1);
  const dot = name.indexOf('.');
  if (dot > 0) {
    const owner = file.getClass(name.slice(0, dot));
    const method = owner === undefined ? undefined : methodNamedOn(owner, name.slice(dot + 1));
    const fn = method === undefined ? undefined : functionOf(method);
    return fn === undefined || owner === undefined ? undefined : { fn, owner };
  }
  const declared = file.getFunction(name);
  if (declared !== undefined) return { fn: declared };
  const initializer = file.getVariableDeclaration(name)?.getInitializer();
  return initializer !== undefined && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) ? { fn: initializer } : undefined;
};

/** Every method in the repository marked by a decorator whose one argument is a value the code states. */
const decoratedMethods = (host: MessageTypeHost): { value: string; method: ClassMethod }[] => {
  const found: { value: string; method: ClassMethod }[] = [];
  for (const file of host.project.getSourceFiles()) {
    if (!isOwnCode(file, host.repoDir)) continue;
    for (const owner of file.getClasses()) {
      for (const method of owner.getMethods()) {
        for (const decorator of method.getDecorators()) {
          const [argument] = decorator.getArguments();
          if (argument === undefined || decorator.getArguments().length !== 1) continue;
          const value = evaluateExpression(argument);
          if (value.resolved && typeof value.value === 'string') found.push({ value: value.value, method });
        }
      }
    }
  }
  return found;
};

/**
 * Reads the type choices of every consumer the repository's readers drew
 * (P358), whichever reader drew it: a decorated handler, a subscription's
 * callback, a browser's message handler. Run after every reader that draws a
 * consumer.
 */
export const readMessageTypes = (host: MessageTypeHost): void => {
  const { builder } = host;
  const edges = builder.edges;
  const handlesFrom = new Map<string, GraphEdge[]>();
  const callsFrom = new Map<string, GraphEdge[]>();
  const callsTo = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (edge.type === 'calls') {
      const list = callsTo.get(edge.to) ?? [];
      list.push(edge);
      callsTo.set(edge.to, list);
    }
    const into = edge.type === 'handles' ? handlesFrom : edge.type === 'calls' ? callsFrom : undefined;
    if (into === undefined) continue;
    const list = into.get(edge.from) ?? [];
    list.push(edge);
    into.set(edge.from, list);
  }
  let decorated: { value: string; method: ClassMethod }[] | undefined;
  const relative = (node: TsNode): string => {
    const path = node.getSourceFile().getFilePath();
    const root = resolvePath(host.repoDir);
    return path.startsWith(root + sep) ? path.slice(root.length + 1).split(sep).join('/') : path;
  };
  /** How a function's calls are looked up, by the node it stands for. */
  const lookupOf = (id: string | undefined): SelectionLookup => ({
    repoDir: host.repoDir,
    calledAt: (line) => {
      const targets = [...new Set((id === undefined ? [] : (callsFrom.get(id) ?? [])).filter((edge) => edge.line === line).map((edge) => edge.to))].filter((each) => {
        const node = builder.getNode(each);
        return node?.type === 'method' || node?.type === 'function';
      });
      return targets.length === 1 ? targets[0] : undefined;
    },
    decorated: () => (decorated ??= decoratedMethods(host)),
  });
  /** The id of the node a chosen handler is, without drawing it. */
  const idOfHandler = (handler: ChosenHandler): string | undefined =>
    handler.kind === 'node'
      ? handler.id
      : handler.kind === 'method'
        ? host.methodIdOf?.(handler.method)
        : handler.kind === 'function'
          ? host.functionIdOf?.(handler.fn)
          : undefined;

  /**
   * A function that chooses nothing and hands the message on to one of the
   * repository's own (P369) - `({ scopeId, data }) => this.dispatch(scopeId,
   * data)` - chooses what that one chooses, read with the message in the
   * parameter it is handed in.
   */
  const deepen = (reading: SelectionReading): SelectionReading => {
    const to = reading.handsTo;
    if (reading.selections.length > 0 || to === undefined || (to.kind !== 'method' && to.kind !== 'function')) return reading;
    const behind = functionOfHandler(to);
    if (behind === undefined) return reading;
    const inner = readSelections(behind.fn, behind.owner, lookupOf(idOfHandler(to)), { parameter: to.argument ?? 0 });
    if (inner.selections.length === 0 && inner.unread.length === 0) return reading;
    const file = relative(behind.fn);
    const itself = withoutArgument(to);
    return {
      selections: inner.selections.map((each) => ({ ...each, file, handler: each.handler.kind === 'self' ? itself : each.handler })),
      unread: [...reading.unread, ...inner.unread.map((row) => ({ ...row, file }))],
      others: inner.others,
    };
  };

  /**
   * The types a handler is run for by the code that calls it (P369): each
   * function of the repository that calls it under a choice on the message it
   * hands it - a route's `switch (event.type)` calling `bot.handleReady(event)`
   * under `case 'ORDER_READY'`. Read as any handler is, every parameter of the
   * caller that can hold a message being one.
   */
  const dispatchedTo = (target: GraphNode): ReadSelection[] => {
    const callers = [...new Set((callsTo.get(target.id) ?? []).map((edge) => edge.from))].sort().slice(0, MOST_CALLERS);
    const out: ReadSelection[] = [];
    for (const callerId of callers) {
      const caller = builder.getNode(callerId);
      if (caller === undefined || (caller.type !== 'method' && caller.type !== 'function')) continue;
      const declaration = declarationOfNode(host, caller);
      if (declaration === undefined) continue;
      const read = readSelections(declaration.fn, declaration.owner, lookupOf(callerId), { everyParameter: true });
      const file = relative(declaration.fn);
      for (const selection of read.selections) {
        if (idOfHandler(selection.handler) !== target.id) continue;
        out.push({ ...selection, handler: { kind: 'self' }, file });
      }
    }
    return out;
  };

  const consumers = builder.nodes.filter((node) => node.type === 'consumer' && node.meta?.[SELECTED_BY_META] === undefined);
  for (const consumer of consumers) {
    if (consumer.meta?.[SELECTS_META] !== undefined || consumer.meta?.[SELECTION_UNREAD_META] !== undefined) continue;
    const [handles] = handlesFrom.get(consumer.id) ?? [];
    // The handler it runs; a consumer drawn with no handler of its own is its handler, written where it is.
    const target = handles === undefined ? consumer : builder.getNode(handles.to);
    if (target === undefined) continue;
    // A screen subscribed to what a stream's frames are pushed into chooses at each subscription, not in the function it is written in (P362).
    const subscriptions = subscriptionsOf(consumer);
    const found = subscriptions.length > 0 ? undefined : target === consumer ? declarationAt(host, consumer.file, consumer.line) : declarationOfNode(host, target);
    if (found === undefined && subscriptions.length === 0) continue;
    const lookup = lookupOf(target.id);
    const readings = subscriptions.flatMap((each) => {
      const at = subscriptionAt(host, consumer.file, each.line, each.column);
      if (at === undefined) return [];
      if ('fn' in at) return [deepen(readSelections(at.fn, classAround(at.fn), lookup))];
      return [deepen(readSubscription(at.subscribe, classAround(at.subscribe), lookup))];
    });
    const read: SelectionReading =
      found !== undefined
        ? deepen(readSelections(found.fn, found.owner, lookup))
        : { selections: readings.flatMap((each) => each.selections), unread: readings.flatMap((each) => each.unread), others: readings.some((each) => each.others) };
    const file = target.file ?? consumer.file ?? '';

    // A handler that chooses nothing in its body (P369): the code calling it
    // under a choice says which types it runs for, and failing that the
    // declared type of its parameter; where both say, and differ, the caller's
    // choice is drawn and a row says so.
    let own: readonly ReadSelection[] = read.selections;
    if (own.length === 0 && read.unread.length === 0 && found !== undefined && (target.type === 'method' || target.type === 'function')) {
      const dispatched = dispatchedTo(target);
      const declared = parameterSelection(found.fn);
      if (dispatched.length > 0) {
        own = dispatched;
        const said = [...new Set(dispatched.map((each) => each.type))].sort();
        if (declared !== undefined && (declared.values.length !== said.length || declared.values.some((value) => !said.includes(value)))) {
          // Said on the consumer too (P397): what is compared under the caller's types rests on one of two sources.
          consumer.meta = {
            ...consumer.meta,
            [SELECTION_DIFFERS_META]: `its parameter's type says ${declared.values.join(', ')}; the code that calls it does so for ${said.join(', ')}`,
          };
          host.report({
            file,
            line: declared.line,
            reason: 'message-type-differs',
            level: 'info',
            hint: `The parameter's type says ${declared.values.join(', ')}; the code that calls it does so for ${said.join(', ')} (${dispatched[0]!.file ?? file}:${dispatched[0]!.line}). The caller's choice is drawn.`,
            symbol: consumer.label,
          });
        }
      } else if (declared !== undefined) {
        own = declared.values.map((type) => ({ type, field: declared.field, via: 'parameter' as const, line: declared.line, handler: { kind: 'self' as const } }));
      }
    }
    // Each choice followed into the function it hands the message to, where that chooses again.
    const followed = followedIn(own, (handler) => lookupOf(idOfHandler(handler)), relative);
    const reading: SelectionReading = { selections: followed.selections, unread: read.unread, others: read.others };
    for (const row of followed.unread) {
      host.report({
        file: row.file ?? file,
        line: row.line,
        reason: 'message-type-unread',
        level: 'info',
        hint: `${row.why} So which handler takes which type of message here is not drawn.`,
        symbol: consumer.label,
      });
    }

    for (const row of reading.unread) {
      host.report({
        file: row.file ?? file,
        line: row.line,
        reason: 'message-type-unread',
        level: 'info',
        hint: `${row.why} So which handler takes which type of message here is not drawn.`,
        symbol: consumer.label,
      });
    }
    if (reading.selections.length === 0) {
      if (reading.unread.length > 0) consumer.meta = { ...consumer.meta, [SELECTION_UNREAD_META]: reading.unread[0]!.why };
      continue;
    }

    const handlerId = (handler: ChosenHandler): string | undefined => {
      if (handler.kind === 'self') return target.id;
      if (handler.kind === 'node') return handler.id;
      if (handler.kind === 'method') {
        const id = host.methodIdOf?.(handler.method);
        if (id !== undefined) host.ensureMethodNode?.(handler.method);
        return id;
      }
      if (host.functionIdOf === undefined || host.ensureFunctionNode === undefined) return undefined;
      return host.ensureFunctionNode(handler.fn) === undefined ? undefined : host.functionIdOf(handler.fn);
    };

    const recorded: Selection[] = [];
    const seen = new Set<string>();
    for (const selection of reading.selections) {
      const id = handlerId(selection.handler) ?? target.id;
      const node = builder.getNode(id);
      const consumerId = id === target.id || node === undefined ? consumer.id : `consumer:${id}`;
      if (consumerId !== consumer.id) {
        const drawn = builder.addNode({
          id: consumerId,
          type: 'consumer',
          label: node!.label,
          repo: host.repo,
          ...(node!.file === undefined ? {} : { file: node!.file }),
          ...(node!.line === undefined ? {} : { line: node!.line }),
          ...(consumer.kind === undefined ? {} : { kind: consumer.kind }),
          meta: {
            ...(consumer.kind === undefined ? {} : { kind: consumer.kind }),
            ...(consumer.meta?.['adapter'] === undefined ? {} : { adapter: consumer.meta['adapter'] }),
            [SELECTED_BY_META]: consumer.id,
            // A handler chosen by code that never runs never runs either.
            ...(typeof consumer.meta?.[UNREACHED_META] === 'string' ? { [UNREACHED_META]: consumer.meta[UNREACHED_META] } : {}),
          },
        });
        if (drawn.meta?.[SELECTED_BY_META] !== undefined) {
          const types = new Set<string>([...((drawn.meta['messageTypes'] as string[] | undefined) ?? []), selection.type]);
          drawn.meta = { ...drawn.meta, messageTypes: [...types].sort() };
        }
        builder.addEdge({
          from: consumerId,
          to: id,
          type: 'handles',
          confidence: selection.heuristic === true ? 'heuristic' : 'static',
          ...(node!.file === undefined ? {} : { file: node!.file }),
          ...(node!.line === undefined ? {} : { line: node!.line }),
        });
      }
      const key = `${selection.type}\u0000${consumerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recorded.push({
        type: selection.type,
        consumer: consumerId,
        via: selection.via,
        line: selection.line,
        ...(selection.file !== undefined
          ? selection.file === consumer.file
            ? {}
            : { file: selection.file }
          : target.file === undefined || target.file === consumer.file
            ? {}
            : { file: target.file }),
        ...(selection.heuristic === true ? { heuristic: true as const } : {}),
      });
    }
    recorded.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.consumer < b.consumer ? -1 : a.consumer > b.consumer ? 1 : 0));
    const fields = [...new Set(reading.selections.map((selection) => selection.field))];
    consumer.meta = {
      ...consumer.meta,
      [DISCRIMINATOR_META]: fields.length === 1 ? fields[0] : fields,
      [SELECTS_META]: recorded,
      ...(reading.others ? { [SELECTS_OTHERS_META]: true } : {}),
      ...(reading.unread.length === 0 ? {} : { [SELECTION_UNREAD_META]: reading.unread[0]!.why }),
    };
  }
};

/** The pass a server's reader runs, after the channel reader. */
export const messageTypesPass: ExtractorPass<MessageTypeHost> = definePass('message-types', readMessageTypes);
