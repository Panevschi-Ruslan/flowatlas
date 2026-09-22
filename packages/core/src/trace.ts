import type {
  CallExpression,
  Identifier,
  ObjectLiteralExpression,
  ParameterDeclaration,
  Symbol as TsSymbol,
  TemplateExpression,
  Node as TsNode,
} from 'ts-morph';
import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';
import {
  bodyOf,
  enclosingMethod,
  functionOf,
  methodNamedOn,
  parametersOf,
  type ClassMethod,
} from './di/member-call.js';
import { holeIn, UNREAD_SPAN } from './ids.js';
import { writtenObjectLiteral } from './origin.js';
import { evaluateExpression, literalUnionOf } from './static-value.js';

/** How far back a value is followed before the answer stops being trustworthy. */
const BUDGET = 8;

/** String methods that reshape a value without changing where it came from. */
const PRESERVING = new Set([
  'replace',
  'replaceAll',
  'trim',
  'trimEnd',
  'trimStart',
  'toString',
  'concat',
  'normalize',
]);

/** Unwraps the parentheses, assertions and non-null marks around a value. */
const unwrap = (node: TsNode): TsNode => {
  let current = node;
  for (;;) {
    if (Node.isParenthesizedExpression(current)) current = current.getExpression();
    else if (Node.isAsExpression(current)) current = current.getExpression();
    else if (Node.isNonNullExpression(current)) current = current.getExpression();
    else if (Node.isTypeAssertion(current)) current = current.getExpression();
    else if (Node.isSatisfiesExpression(current)) current = current.getExpression();
    else return current;
  }
};

/**
 * Follows a local binding to what it was given, leaving anything else alone.
 *
 * Only a `const` is followed. A binding that can be reassigned may say one
 * thing where it is declared and another where it is used, and an address read
 * from the wrong one becomes an edge claiming a call that never happens.
 */
export const deref = (node: TsNode, budget = BUDGET): TsNode => {
  if (budget <= 0) return node;
  const current = unwrap(node);
  if (!Node.isIdentifier(current)) return current;
  const declaration = current.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return current;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) {
    return current;
  }
  const initializer = declaration.getInitializer();
  return initializer === undefined ? current : deref(initializer, budget - 1);
};

const enclosingClass = (node: TsNode) => node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);

type ClassNode = NonNullable<ReturnType<typeof enclosingClass>>;

/**
 * A class and the ones it extends.
 *
 * A shared base class holding the address is the ordinary way to write a set of
 * services, so a property missing from the class that uses it is usually
 * declared one level up rather than nowhere.
 */
const classChain = (declaration: ClassNode | undefined, depth = 4): ClassNode[] => {
  const chain: ClassNode[] = [];
  let current = declaration;
  while (current !== undefined && chain.length < depth) {
    chain.push(current);
    current = current.getBaseClass();
  }
  return chain;
};

/** Everywhere `new C(...)` appears for this class. */
const instantiationsOf = (declaration: ClassNode | undefined): TsNode[] => {
  if (declaration === undefined) return [];
  const sites: TsNode[] = [];
  for (const reference of declaration.findReferencesAsNodes()) {
    const parent = reference.getParent();
    if (parent !== undefined && Node.isNewExpression(parent)) sites.push(parent);
  }
  return sites;
};

/** Assignments to `this.<name>`, in the class that declares it or one it extends. */
const assignmentsTo = (name: string, declaration: ClassNode | undefined): TsNode[] => {
  const found: TsNode[] = [];
  for (const owner of classChain(declaration)) found.push(...assignmentsIn(name, owner));
  return found;
};

const assignmentsIn = (name: string, declaration: ClassNode): TsNode[] => {
  const found: TsNode[] = [];
  const initializer = declaration.getProperty(name)?.getInitializer();
  if (initializer !== undefined) found.push(initializer);

  // `get base() { return `https://api.example.com/v2`; }` holds its one return
  // every time it is read, which is what an initializer says too. A getter that
  // decides between several is a hole, as a reassigned field is.
  const getter = declaration.getGetAccessor(name);
  if (getter !== undefined) {
    const returns = ownReturns(getter);
    const returned = returns.length === 1 ? returns[0]?.asKind(SyntaxKind.ReturnStatement)?.getExpression() : undefined;
    if (returned !== undefined) found.push(returned);
  }

  for (const constructor of declaration.getConstructors()) {
    const body = constructor.getBody();
    if (body !== undefined) found.push(...writesTo(name, body));
  }
  return found;
};

/** Every `this.<name> = value` written anywhere inside one node. */
const writesTo = (name: string, container: TsNode): TsNode[] => {
  const found: TsNode[] = [];
  for (const assignment of container.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = assignment.getLeft();
    if (!Node.isPropertyAccessExpression(left)) continue;
    if (left.getName() !== name) continue;
    if (left.getExpression().getKind() !== SyntaxKind.ThisKeyword) continue;
    found.push(assignment.getRight());
  }
  return found;
};

/** The constructor parameter that declares `this.<name>`, and its position. */
const parameterPropertyOf = (
  name: string,
  declaration: ClassNode | undefined,
): { classNode: ClassNode; index: number } | undefined => {
  for (const owner of classChain(declaration)) {
    for (const constructor of owner.getConstructors()) {
      const parameters = constructor.getParameters();
      for (let index = 0; index < parameters.length; index += 1) {
        const parameter = parameters[index];
        if (parameter === undefined || parameter.getName() !== name) continue;
        if (parameter.getModifiers().length === 0) continue;
        return { classNode: owner, index };
      }
    }
  }
  return undefined;
};

export interface RootSettingOptions {
  /**
   * Recognises a settings read where it stands, and names the key.
   *
   * Supplied by whoever knows how this kind of project reads its settings: a
   * settings service, the process environment, a module a build swaps out. The
   * core follows values around; it does not know what a setting looks like.
   */
  readSetting: (node: TsNode) => string | null;
  budget?: number;
}

/**
 * A settings key, and the literal path already written after it.
 *
 * `private base = `${environment.apiUrl}/admin/platform`` is a key and a prefix.
 * Answering with the key alone loses `/admin/platform`, and every request the
 * service makes is then reported against a path two segments short of the one it
 * actually asks for — which reads as the other service having dropped a route.
 */
export interface SettingAddress {
  key: string;
  /** Text between the settings value and whatever the caller appends. */
  prefix: string;
  /**
   * Whether a branch nobody settled was taken to get here.
   *
   * Only the path can be reached this way; the key is the same on both sides of
   * such a branch or there is no answer at all. Whoever turns this address into
   * an edge has to carry it: an address arrived at through a guess is a
   * `heuristic` edge, never a `static` one.
   */
  guessed?: boolean;
}

/**
 * What the trace knows about where it is.
 *
 * `self` is the class the address was written in, kept as the trace descends
 * into a base class: `this.getResourcePath()` is abstract there and answered by
 * the subclass, so the class at the bottom of the stack is the one that knows.
 *
 * `bound` is what a helper's parameters were given at the call site, so
 * `buildAdminUrl(depotId, 'available')` reads as far as the argument does.
 */
interface Scope {
  /** Recognises a settings read and names the key. Supplied by the caller. */
  readSetting: (node: TsNode) => string | null;
  self: ClassNode | undefined;
  bound: ReadonlyMap<ParameterDeclaration, Bound>;
  /**
   * A value picked for each lookup into a fixed table, when the reader is
   * enumerating what the table can give rather than reading one answer.
   */
  choices?: ReadonlyMap<TsNode, string>;
}

/** An argument, and the scope it was written in, since it may be a name there. */
interface Bound {
  node: TsNode;
  scope: Scope;
}

const NOTHING: ReadonlyMap<ParameterDeclaration, Bound> = new Map();

/** The class the trace started in, then the one the code is written in. */
const chainFrom = (scope: Scope, node: TsNode): ClassNode[] => {
  const chain = classChain(scope.self);
  for (const owner of classChain(enclosingClass(node))) {
    if (!chain.includes(owner)) chain.push(owner);
  }
  return chain;
};

/** What a helper's parameters were given, so its body can be read with them. */
const bindings = (
  method: ClassMethod,
  call: CallExpression,
  scope: Scope,
): ReadonlyMap<ParameterDeclaration, Bound> => {
  const bound = new Map<ParameterDeclaration, Bound>();
  const args = call.getArguments();
  parametersOf(method).forEach((parameter, index) => {
    const argument = args[index];
    if (argument !== undefined) bound.set(parameter, { node: argument, scope });
    else {
      // Nothing was passed, so the parameter holds its default, which is written
      // in the helper rather than at the call site.
      const fallback = parameter.getInitializer();
      if (fallback !== undefined) {
        bound.set(parameter, { node: fallback, scope: { ...scope, bound: NOTHING } });
      }
    }
  });
  return bound;
};

/**
 * The object literal a value stands for, and the scope that literal was written
 * in.
 *
 * A wrapper that cannot act on what it was given keeps it: `this.params = {
 * url, key }`, and later `this.open(this.params)`. Following the address
 * through that means following the object, which is one parameter, one field
 * and one literal away.
 *
 * A field written in more than one place is refused. Two writers mean two
 * possible objects and nothing here says which one a call reads, and a reader
 * that picked the first would be inventing an address rather than reading one.
 */
/**
 * One hop towards where a name's value was written, with the scope to read it in.
 *
 * A parameter is answered by whoever called the method that declared it, and a
 * `const` by its initializer. Both are a step of the same kind — a different
 * node, read in a possibly different scope — which is what `Bound` is.
 */
const substituted = (name: Identifier, scope: Scope): Bound | null => {
  const declaration = symbolBehind(name)?.getDeclarations()[0];
  if (declaration === undefined) return null;
  if (Node.isParameterDeclaration(declaration)) return scope.bound.get(declaration) ?? null;
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer === undefined ? null : { node: initializer, scope };
  }
  return null;
};

const objectHolding = (
  value: TsNode,
  scope: Scope,
  budget: number,
): { node: ObjectLiteralExpression; scope: Scope } | null => {
  if (budget <= 0) return null;
  const node = unwrap(value);
  if (Node.isObjectLiteralExpression(node)) return { node, scope };

  if (Node.isIdentifier(node)) {
    const next = substituted(node, scope);
    return next === null ? null : objectHolding(next.node, next.scope, budget - 1);
  }

  if (
    Node.isPropertyAccessExpression(node) &&
    node.getExpression().getKind() === SyntaxKind.ThisKeyword
  ) {
    const only = objectWrittenTo(node.getName(), scope.self ?? enclosingClass(node));
    return only === undefined ? null : objectHolding(only, scope, budget - 1);
  }
  return null;
};

/**
 * The one object a field is ever given, or nothing when that is not one object.
 *
 * Unlike the constant trace, this looks inside every method: a field a wrapper
 * remembers something in is assigned where the wrapper was called, not where it
 * was declared. `= null` is not a competing answer — it is the field saying it
 * holds nothing yet — so it is passed over; anything else that is not the one
 * literal makes this refuse, because two writers mean the reader cannot say
 * which object a later read sees.
 */
const objectWrittenTo = (
  name: string,
  declaration: ClassNode | undefined,
): ObjectLiteralExpression | undefined => {
  const written: TsNode[] = [];
  for (const owner of classChain(declaration)) {
    const initializer = owner.getProperty(name)?.getInitializer();
    if (initializer !== undefined) written.push(initializer);
    // The whole class, not only its constructors: a field a wrapper remembers
    // something in is written where the wrapper was called, which is a method.
    written.push(...writesTo(name, owner));
  }
  const values = written.map(unwrap).filter((value) => !isEmptyValue(value));
  const only = values.length === 1 ? values[0] : undefined;
  return only !== undefined && Node.isObjectLiteralExpression(only) ? only : undefined;
};

/** `null` and `undefined`: a field saying it holds nothing, rather than what it holds. */
const isEmptyValue = (node: TsNode): boolean => {
  const value = unwrap(node);
  return (
    value.getKind() === SyntaxKind.NullKeyword ||
    (Node.isIdentifier(value) && value.getText() === 'undefined')
  );
};

/**
 * What one property of a remembered object holds, with the scope to read it in.
 *
 * The scope is the one the literal was written in, not the one it is read in:
 * `{ url, key }` written inside `connect` names `connect`'s parameters, and
 * those are answered by whoever called `connect`.
 */
const rememberedProperty = (value: TsNode, scope: Scope, budget: number): Bound | null => {
  if (budget <= 0) return null;
  const access = unwrap(value);
  if (!Node.isPropertyAccessExpression(access)) return null;
  if (access.getExpression().getKind() === SyntaxKind.ThisKeyword) return null;

  const holder = objectHolding(access.getExpression(), scope, budget - 1);
  if (holder === null) return null;
  const property = holder.node.getProperty(access.getName());
  if (property === undefined) return null;
  if (Node.isPropertyAssignment(property)) {
    const initializer = property.getInitializer();
    return initializer === undefined ? null : { node: initializer, scope: holder.scope };
  }
  // `{ url }` names a value rather than writing one, so the step from it is the
  // same step any other name takes.
  if (Node.isShorthandPropertyAssignment(property)) {
    return substituted(property.getNameNode(), holder.scope);
  }
  return null;
};

/**
 * The constant a method answers with, looked for in a named class first.
 *
 * `constantMethodResult` asks the class the call is written in. That is the base
 * class when the trace has descended into one, where the method is abstract and
 * has no answer; the subclass at the top of the stack is the one that overrode
 * it.
 */
const constantIn = (node: TsNode, scope: Scope): string | null => {
  const call = unwrap(node);
  if (!Node.isCallExpression(call) || call.getArguments().length > 0) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return null;

  for (const owner of chainFrom(scope, call)) {
    const answer = constantReturnOf(methodNamedOn(owner, callee.getName()));
    if (answer !== null) return answer;
  }
  return null;
};

/** The one string every return of a method gives, when they all give the same. */
const constantReturnOf = (method: ClassMethod | undefined): string | null => {
  if (method === undefined) return null;
  const answers = answersOf(method, true);
  if (answers.length === 0) return null;
  const values = new Set<string>();
  for (const expression of answers) {
    const value = evaluateExpression(expression);
    if (!value.resolved || typeof value.value !== 'string') return null;
    values.add(value.value);
  }
  return values.size === 1 ? (([...values][0] as string) ?? null) : null;
};

/**
 * A string read outright, following names and arguments but never guessing.
 *
 * Used for the parts of an address that are not its root: a segment, a suffix, a
 * condition. Answers null when the value is only known at run time, which the
 * caller turns into a hole rather than filling in.
 */
const readString = (value: TsNode, scope: Scope, budget: number): string | null => {
  if (budget <= 0) return null;
  const node = unwrap(value);

  const direct = evaluateExpression(node);
  if (direct.resolved && typeof direct.value === 'string') return direct.value;

  const chosen = scope.choices?.get(node);
  if (chosen !== undefined) return chosen;

  if (Node.isTemplateExpression(node)) {
    let text = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) {
      const piece = readString(span.getExpression(), scope, budget - 1);
      if (piece === null) return null;
      text += piece + span.getLiteral().getLiteralText();
    }
    return text;
  }

  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return null;
    if (Node.isParameterDeclaration(declaration)) {
      const bound = scope.bound.get(declaration);
      return bound === undefined ? null : readString(bound.node, bound.scope, budget - 1);
    }
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      return initializer === undefined ? null : readString(initializer, scope, budget - 1);
    }
    return null;
  }

  // `private uploadPath = '/admin/upload'` — a piece of the path kept in a
  // property, which is a constant wearing a field's clothes. Only when every
  // assignment agrees: one that is decided at run time is a hole.
  if (
    Node.isPropertyAccessExpression(node) &&
    node.getExpression().getKind() === SyntaxKind.ThisKeyword
  ) {
    const values = new Set<string>();
    for (const assigned of assignmentsTo(node.getName(), scope.self ?? enclosingClass(node))) {
      const value = readString(assigned, scope, budget - 1);
      if (value === null || ABSOLUTE.test(value)) return null;
      values.add(value);
    }
    return values.size === 1 ? (([...values][0] as string) ?? null) : null;
  }

  const remembered = rememberedProperty(node, scope, budget);
  if (remembered !== null) return readString(remembered.node, remembered.scope, budget - 1);

  return constantIn(node, scope);
};

/** An address that names a host outright, which is never a piece of a path. */
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * The constant a property always holds, when it always holds the same.
 *
 * `private uploadPath = '/admin/upload'` is a piece of every address the service
 * writes, kept in a field because it is written in several methods. Reading it
 * is the difference between a path and a hole where its middle should be.
 *
 * A value naming a host is refused. That is a base address rather than a piece
 * of a path, and where it came from is a question for the settings trace.
 */
export const constantPropertyValue = (
  node: TsNode,
  options: { allowHost?: boolean } = {},
): string | null => {
  const access = unwrap(node);
  if (!Node.isPropertyAccessExpression(access)) return null;
  if (access.getExpression().getKind() !== SyntaxKind.ThisKeyword) return null;
  const values = new Set<string>();
  for (const assigned of assignmentsTo(access.getName(), enclosingClass(access))) {
    const value = evaluateExpression(assigned);
    if (!value.resolved || typeof value.value !== 'string') return null;
    // A caller reading the opening of an address may ask for the host too:
    // where there is no setting behind it, the host written down is the answer.
    if (options.allowHost !== true && ABSOLUTE.test(value.value)) return null;
    values.add(value.value);
  }
  return values.size === 1 ? (([...values][0] as string) ?? null) : null;
};

/**
 * Whether a hole picks a name rather than carrying a value.
 *
 * `ENTITY_PATH[entityType]` and the abstract `this.getResourcePath()` are not
 * values filling a route parameter. Each is one of a handful of segments the
 * project spells out somewhere, chosen by something only known here at run time.
 * A route declares a hole for values, not for a choice between the names it
 * writes down itself, so calling one of these `:param` matches routes it never
 * reaches.
 *
 * Nothing else qualifies. `this.auth.getCurrentDepotId()` asks a
 * collaborator for a value, `encodeURIComponent(id)` and `id.toString()` are the
 * value `id` wearing different spelling, and a route parameter is exactly what
 * all three fill.
 */
export const choosesASegment = (node: TsNode): boolean => {
  const value = deref(node);
  if (Node.isElementAccessExpression(value)) return true;
  if (!Node.isCallExpression(value) || value.getArguments().length > 0) return false;
  const callee = value.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return false;
  // A method the class declares but does not answer. Every subclass answers it
  // with its own name, and which subclass this is cannot be told from here.
  for (const owner of classChain(enclosingClass(value))) {
    const method = methodNamedOn(owner, callee.getName());
    if (method === undefined) continue;
    // A method written as a field always has its body with it; only a declared
    // one can be abstract or left to a subclass.
    return Node.isMethodDeclaration(method) && (method.isAbstract() || method.getBody() === undefined);
  }
  return false;
};

/**
 * What is known about a condition: settled either way, or one of two kinds of
 * unsettled.
 *
 * `given` is the kind somebody decided and nobody here can read: the caller
 * wrote an argument, and whether it is empty is settled further out than this
 * goes. `undefined` is the kind nobody decided at all, which includes a
 * parameter nothing was ever passed for.
 */
type Truth = boolean | 'given' | undefined;

/**
 * Whether a condition is settled by what the caller passed, when it is.
 *
 * `path ? `${base}/${path}` : base` is how a helper takes an optional tail. The
 * caller usually settles it: nothing passed means the empty default and the bare
 * base, and a piece of a path passed means the longer branch — including a piece
 * whose middle is a hole, since a string with any literal text in it is never
 * empty whatever the hole turns out to be.
 *
 * `url(rid, id)` is the one it cannot settle, and it is not the same as saying
 * nothing is known: a caller who wrote an argument is not asking for the default
 * the guard exists for. That answers `given`, and whoever acts on it owes the
 * reader a guess rather than a fact.
 */
const truthOf = (condition: TsNode, scope: Scope, budget: number): Truth => {
  if (budget <= 0) return undefined;
  const node = unwrap(condition);

  // A value that can be read where it stands settles the condition by being
  // empty or not, whatever its type: `''`, `null`, `0` and `false` all mean the
  // branch for nothing passed.
  const direct = evaluateExpression(node);
  if (direct.resolved) return Boolean(direct.value);

  const read = readString(condition, scope, budget);
  if (read !== null) return read !== '';

  if (Node.isTemplateExpression(node)) {
    const literals = [
      node.getHead().getLiteralText(),
      ...node.getTemplateSpans().map((span) => span.getLiteral().getLiteralText()),
    ];
    return literals.some((text) => text !== '') ? true : undefined;
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isParameterDeclaration(declaration)) {
      const bound = scope.bound.get(declaration);
      // Nobody wrote anything here to go on: either the trace never descended
      // through a call, or it did and this parameter was left out. Which of the
      // two cannot be told apart from here, so neither is claimed.
      if (bound === undefined) return undefined;
      return truthOf(bound.node, bound.scope, budget - 1) ?? 'given';
    }
  }
  return undefined;
};

/**
 * A piece of a path, read as far as it can be and holed where it cannot.
 *
 * Unlike `readString` this always answers. A caller passing `` `${id}/adjust` ``
 * to a helper is passing two segments, one of them a value: reading it as one
 * hole would lose the second, and refusing to read it would lose both.
 */
const pathOf = (
  value: TsNode,
  scope: Scope,
  budget: number,
  before: string,
  after: string,
  last: boolean,
): string => {
  const exact = readString(value, scope, budget);
  if (exact !== null) return exact;
  // The tail of an address that is only ever a query string adds nothing to the
  // route it reaches.
  if (last && after === '' && queryOnly(value, scope, budget)) return '';
  const hole = (node: TsNode): string =>
    choosesASegment(node) ? UNREAD_SPAN : holeIn(before, after, last);
  if (budget <= 0) return hole(value);

  const node = unwrap(value);
  if (Node.isTemplateExpression(node)) {
    const spans = node.getTemplateSpans().slice(0, spansThatCount(node, scope, budget));
    let text = node.getHead().getLiteralText();
    spans.forEach((span, index) => {
      const literal = span.getLiteral().getLiteralText();
      const isLast = index === spans.length - 1;
      text +=
        pathOf(
          span.getExpression(),
          scope,
          budget - 1,
          before + text,
          isLast ? after : literal,
          isLast && last,
        ) + literal;
    });
    return text;
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isParameterDeclaration(declaration)) {
      const bound = scope.bound.get(declaration);
      if (bound !== undefined) {
        return pathOf(bound.node, bound.scope, budget - 1, before, after, last);
      }
    }
  }
  const remembered = rememberedProperty(node, scope, budget);
  if (remembered !== null) {
    return pathOf(remembered.node, remembered.scope, budget - 1, before, after, last);
  }
  return hole(node);
};

/**
 * How many of a template's holes add to the route, counted from the front.
 *
 * Trailing holes that are only ever a query string or nothing, with no text
 * after them, are not counted: `/deals/${id}${query}` ends at `id` as far as the
 * route is concerned, and `id` fills a segment of its own.
 */
const spansThatCount = (template: TemplateExpression, scope: Scope, budget: number): number => {
  const spans = template.getTemplateSpans();
  let end = spans.length;
  while (end > 0) {
    const span = spans[end - 1];
    if (span === undefined || span.getLiteral().getLiteralText() !== '') break;
    if (evaluateExpression(span.getExpression()).resolved) break;
    if (!queryOnly(span.getExpression(), scope, budget - 1)) break;
    end -= 1;
  }
  return end;
};

/** The literal text a template writes after the hole at `from`, holes included. */
const tailFrom = (
  template: TemplateExpression,
  from: number,
  scope: Scope,
  budget: number,
): string => {
  const spans = template.getTemplateSpans();
  const end = spansThatCount(template, scope, budget);
  let text = spans[from]?.getLiteral().getLiteralText() ?? '';
  for (let index = from + 1; index < end; index += 1) {
    const span = spans[index];
    if (span === undefined) continue;
    const literal = span.getLiteral().getLiteralText();
    const last = index === end - 1;
    text += pathOf(span.getExpression(), scope, budget - 1, text, literal, last) + literal;
  }
  return text;
};

/**
 * The part two paths agree on, cut at a separator.
 *
 * `/admin/:id/tables` and `/admin/:id/tables/:param` agree on a whole path and
 * differ only in what follows it, so all of it is kept. `/orders` and `/ordered`
 * agree on six characters in the middle of a segment, which is not agreement
 * about anything, so that is cut back.
 */
const sharedStart = (a: string, b: string): string => {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  const boundary = (text: string): boolean => index >= text.length || text[index] === '/';
  if (boundary(a) && boundary(b)) return a.slice(0, index);
  const cut = a.slice(0, index).lastIndexOf('/');
  return cut < 0 ? '' : a.slice(0, cut + 1);
};

const addressOf = (value: TsNode, scope: Scope, budget: number): SettingAddress | null => {
  if (budget <= 0) return null;
  const node = unwrap(value);

  const direct = scope.readSetting(node);
  if (direct !== null) return { key: direct, prefix: '' };

  if (Node.isTemplateExpression(node)) {
    const [first] = node.getTemplateSpans();
    if (node.getHead().getLiteralText() !== '' || first === undefined) return null;
    const root = addressOf(first.getExpression(), scope, budget - 1);
    return root === null ? null : { ...root, prefix: root.prefix + tailFrom(node, 0, scope, budget) };
  }

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return null;
    // `base.replace(...)` and friends reshape the base, which is the half being
    // dropped anyway, so nothing is added to what follows it.
    if (PRESERVING.has(callee.getName())) return addressOf(callee.getExpression(), scope, budget - 1);
    if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) {
      // `this.crate.exportUrl(id)` — a helper on another object of this
      // repository assembles the address, and its own class answers `this`.
      const declared = callee.getExpression().getType().getSymbol()?.getDeclarations()[0];
      if (declared === undefined || !Node.isClassDeclaration(declared)) return null;
      if (declared.getSourceFile().isInNodeModules() || declared.getSourceFile().isDeclarationFile()) {
        return null;
      }
      for (const owner of classChain(declared)) {
        const method = methodNamedOn(owner, callee.getName());
        if (method === undefined) continue;
        // Every return of the method's own, and they have to agree: a helper
        // on another object that answers differently per branch is a hole,
        // not whichever branch happens to read first.
        const inside: Scope = { ...scope, self: declared, bound: bindings(method, node, scope) };
        const answers = answersOf(method).map((returned) => addressOf(returned, inside, budget - 1));
        const [first] = answers;
        // Nothing to read here is not an answer: a base class further along the
        // chain may declare the method this one only names.
        if (first === undefined) continue;
        if (first === null) return null;
        const same = answers.every(
          (answer) => answer !== null && answer.key === first.key && answer.prefix === first.prefix,
        );
        return same ? first : null;
      }
      return null;
    }
    for (const owner of chainFrom(scope, node)) {
      const method = methodNamedOn(owner, callee.getName());
      if (method === undefined) continue;
      const inside: Scope = { ...scope, bound: bindings(method, node, scope) };
      for (const returned of answersOf(method, true)) {
        const found = addressOf(returned, inside, budget - 1);
        if (found !== null) return found;
      }
    }
    return null;
  }

  // `a ? b : c`. Where the caller settled the condition, that branch is the
  // answer. Where a caller wrote an argument nobody can read, the branch it
  // would take is the answer and the address says it was guessed. Where nobody
  // decided anything, the two branches agree as far as they agree and the rest
  // is a hole: picking one there would be inventing a path.
  if (Node.isConditionalExpression(node)) {
    const settled = truthOf(node.getCondition(), scope, budget);
    if (settled === true) return addressOf(node.getWhenTrue(), scope, budget - 1);
    if (settled === false) return addressOf(node.getWhenFalse(), scope, budget - 1);
    const whenTrue = addressOf(node.getWhenTrue(), scope, budget - 1);
    const whenFalse = addressOf(node.getWhenFalse(), scope, budget - 1);
    if (whenTrue === null) return whenFalse;
    if (whenFalse === null) return whenTrue;
    // The key is settled before anything is guessed, so a guess can only ever
    // reach the path. A caller reading the key alone is left where it was.
    if (whenTrue.key !== whenFalse.key) return null;
    if (whenTrue.prefix === whenFalse.prefix) return whenTrue;
    if (settled === 'given') return { ...whenTrue, guessed: true };
    return {
      key: whenTrue.key,
      prefix: sharedStart(whenTrue.prefix, whenFalse.prefix) + UNREAD_SPAN,
    };
  }

  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
      return addressOf(node.getLeft(), scope, budget - 1) ?? addressOf(node.getRight(), scope, budget - 1);
    }
    if (operator === SyntaxKind.PlusToken) {
      const left = addressOf(node.getLeft(), scope, budget - 1);
      if (left === null) return null;
      // `base + path` is a wrapper's whole address, and the path is read as far
      // as it can be, holes and all, rather than dropped whole at the first one.
      const right = node.getRight();
      const tail = queryOnly(right, scope, budget - 1)
        ? ''
        : pathOf(right, scope, budget - 1, left.prefix, '', true);
      return { ...left, prefix: left.prefix + tail };
    }
    return null;
  }

  // `this.baseUrl` — either assigned somewhere in the class, or handed to the
  // constructor, in which case the answer is at every `new C(...)`.
  if (
    Node.isPropertyAccessExpression(node) &&
    node.getExpression().getKind() === SyntaxKind.ThisKeyword
  ) {
    const owner = scope.self ?? enclosingClass(node);
    const name = node.getName();
    for (const assigned of assignmentsTo(name, owner)) {
      const found = addressOf(assigned, scope, budget - 1);
      if (found !== null) return found;
    }
    const parameter = parameterPropertyOf(name, owner);
    if (parameter === undefined) return null;
    for (const site of instantiationsOf(parameter.classNode)) {
      const argument = site.asKind(SyntaxKind.NewExpression)?.getArguments()[parameter.index];
      if (argument === undefined) continue;
      const found = addressOf(argument, scope, budget - 1);
      if (found !== null) return found;
    }
    return null;
  }

  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return null;
    if (Node.isParameterDeclaration(declaration)) {
      const bound = scope.bound.get(declaration);
      return bound === undefined ? null : addressOf(bound.node, bound.scope, budget - 1);
    }
    if (!Node.isVariableDeclaration(declaration)) return null;
    const initializer = declaration.getInitializer();
    return initializer === undefined ? null : addressOf(initializer, scope, budget - 1);
  }

  // `p.url`, where `p` is the object a wrapper remembered what it was given in.
  const remembered = rememberedProperty(node, scope, budget);
  if (remembered !== null) return addressOf(remembered.node, remembered.scope, budget - 1);

  return null;
};

/**
 * Follows a string value back to the settings key it is rooted at, and to
 * whatever literal path it has already written after it.
 *
 * The address a service calls is rarely written where the request is made. It
 * arrives as a constructor argument, is kept in a property, is passed through a
 * helper that appends a resource name, is reshaped by a `replace` and a ternary,
 * and is only then interpolated into a template. None of that changes where it
 * came from, so all of it is followed through — and the path written along the
 * way is kept, because a request reported two segments short of the one it makes
 * reads as the other service having dropped a route.
 *
 * Where the path stops being readable the rest is a hole, and a hole makes the
 * whole address unmatchable rather than approximately right. The one exception
 * is a branch a caller's own argument decides, which is answered with the branch
 * that argument takes and marked `guessed`; nothing else here guesses, and the
 * settings key never does.
 */
export const rootSettingAddress = (
  value: TsNode,
  options: RootSettingOptions & { frames?: readonly CallFrame[] },
): SettingAddress | null =>
  addressOf(value, scopeOf(value, options.readSetting, options.frames), options.budget ?? BUDGET);

/**
 * One step outward from where an address is written: a call, and the method it
 * calls.
 *
 * A shared client writes its request once, inside a method that takes the path
 * as a parameter, and the address only exists once somebody calls it. A list of
 * these, innermost first, is how a reader stands at the call site and reads the
 * request as that caller makes it: every parameter bound to what was passed, and
 * an abstract method answered by the class the caller actually is.
 */
export interface CallFrame {
  call: CallExpression;
  method: ClassMethod;
}

/** The class a call reaches, which is the class that answers `this` inside it. */
const selfAcross = (
  call: CallExpression,
  method: ClassMethod,
  caller: Scope,
): ClassNode | undefined => {
  const callee = unwrap(call.getExpression());
  // `this.get(...)` stays in the object that made the call. When that object is
  // a subclass, the subclass is the one that overrides whatever the base leaves
  // abstract, so it has to stay at the bottom of the stack.
  if (
    Node.isPropertyAccessExpression(callee) &&
    callee.getExpression().getKind() === SyntaxKind.ThisKeyword
  ) {
    return caller.self ?? enclosingClass(call);
  }
  // `this.api.get(...)` reaches another object, whose own class answers.
  const receiver = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
  const declared = receiver?.getType().getSymbol()?.getDeclarations()[0];
  if (declared !== undefined && Node.isClassDeclaration(declared)) return declared;
  return enclosingClass(method);
};

/** The scope an address is read in, standing at the outermost of the frames. */
const scopeOf = (
  value: TsNode,
  readSetting: Scope['readSetting'],
  frames: readonly CallFrame[] | undefined,
  choices?: ReadonlyMap<TsNode, string>,
): Scope => {
  const picked = choices === undefined ? {} : { choices };
  if (frames === undefined || frames.length === 0) {
    return { readSetting, self: enclosingClass(value), bound: NOTHING, ...picked };
  }
  const outermost = frames[frames.length - 1] as CallFrame;
  let scope: Scope = {
    readSetting,
    self: enclosingClass(outermost.call),
    bound: NOTHING,
    ...picked,
  };
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index] as CallFrame;
    scope = {
      readSetting,
      self: selfAcross(frame.call, frame.method, scope),
      bound: bindings(frame.method, frame.call, scope),
      ...picked,
    };
  }
  return scope;
};

/**
 * What an address is, read at the call site the frames lead out to.
 *
 * The settings key comes back when the address is rooted at one, and `null`
 * when it is not; the path is read either way, holed where nothing can read it.
 * Unlike `rootSettingAddress` this answers for an address that names no setting
 * at all — a relative path, or one naming its host outright — because a request
 * made through a wrapper is still a request when the wrapper hard-codes its base.
 */
export const addressAt = (
  value: TsNode,
  options: RootSettingOptions & {
    frames?: readonly CallFrame[];
    choices?: ReadonlyMap<TsNode, string>;
  },
): { key: string | null; text: string; guessed?: boolean } => {
  // Reading from a call site walks back through every wrapper on the way before
  // it reaches the wrapper's own helpers, so it is given the room those take.
  const budget = options.budget ?? BUDGET + 4;
  const scope = scopeOf(value, options.readSetting, options.frames, options.choices);
  const rooted = addressOf(value, scope, budget);
  if (rooted !== null) {
    return {
      key: rooted.key,
      text: rooted.prefix,
      ...(rooted.guessed === true ? { guessed: true } : {}),
    };
  }
  return { key: null, text: pathOf(value, scope, budget, '', '', true) };
};

/**
 * The object a body argument turns out to be, followed out to where it is written.
 *
 * A request's address and its body are not decided in the same place. A service
 * method writes the address — `this.url(id, 'zones')` — and takes the body as a
 * parameter, so the address stops travelling at that method and the body does
 * not: the object is written by whoever called it. Reading the body where the
 * request is made finds a parameter typed `Partial<Item>`, which says every
 * key of `Item` is *permitted* and none is present, and reporting the
 * permission as the act said the call sends fields no call there writes (R34).
 *
 * Followed through a `const` it was parked in, and out to the callers that
 * write it. Several callers answer with several objects: what the boundary
 * carries is what any of them may send, which is their keys together. Every
 * one of them has to be written in place for that to mean anything. Two callers may write two
 * different objects, and there is one shape per boundary to record; the declared
 * type is then the honest answer, and the finding built on it says so.
 *
 * Four steps, because the ordinary shape costs three of them: a parameter of
 * the service method, the caller's argument, the `const` it was parked in, and
 * the literal itself.
 */
export const writtenBodyOutward = (argument: TsNode | undefined, depth = 4): TsNode[] => {
  let value = argument;
  for (let left = depth; left > 0; left -= 1) {
    if (value === undefined) return [];
    if (writtenObjectLiteral(value) !== undefined) return [value];
    const node = unwrap(value);
    if (!Node.isIdentifier(node)) return [];
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return [];
    // `const body = { … }` a line above the call, which is how a form's value
    // is nearly always assembled before it is sent. `const` because a `let`
    // the reader has not followed may hold something else by the time the call
    // is made.
    if (Node.isVariableDeclaration(declaration)) {
      const statement = declaration.getVariableStatement();
      if (statement?.getDeclarationKind() !== VariableDeclarationKind.Const) return [];
      value = declaration.getInitializer();
      continue;
    }
    const method = enclosingMethod(node);
    if (method === undefined) return [];
    const index = parametersOf(method).findIndex((parameter) => parameter === declaration);
    if (index < 0) return [];
    const sites = callSitesOf(method);
    if (sites.length === 0) return [];
    const written = sites.map((site) => site.getArguments()[index]);
    // One caller is followed further out: it may itself have parked the object
    // in a `const`, or be a wrapper of its own. Several are read where they
    // are, because a chain that forks is a chain with nothing at the end of it.
    if (sites.length === 1) {
      value = written[0];
      continue;
    }
    // `updateStaff(id, { role })`, `updateStaff(id, { isActive })`,
    // `updateStaff(id, { permissions })` — three callers, three objects, and
    // what the boundary carries is what any of them may send. Every one of
    // them has to be an object written in place: one caller passing a name is
    // a caller whose keys are unknown, and an unknown set is not a set (R34).
    return written.every((each) => writtenObjectLiteral(each) !== undefined)
      ? (written as TsNode[])
      : [];
  }
  return [];
};

/**
 * The method a parameter belongs to, however that method was written.
 *
 * `handle(url: string) {}` keeps its parameters on itself; `handle = (url) =>
 * {}` keeps them on the arrow, and the thing callers name is the property the
 * arrow was assigned to. Asking only for a `MethodDeclaration` answers nothing
 * for the second, so a request forwarded through a wrapper written that way
 * stopped at the wrapper (R29).
 */
const methodHolding = (parameter: ParameterDeclaration): ClassMethod | undefined => {
  const owner = parameter.getParent();
  if (owner === undefined) return undefined;
  if (Node.isMethodDeclaration(owner)) return owner;
  if (!Node.isArrowFunction(owner) && !Node.isFunctionExpression(owner)) return undefined;
  const property = owner.getParent();
  return property !== undefined && Node.isPropertyDeclaration(property) ? property : undefined;
};

/**
 * Everywhere a method is called, as a call expression.
 *
 * A reference that is not the callee — the method passed as a value, or named
 * in a type — is not a call and is left out.
 */
export const callSitesOf = (method: ClassMethod): CallExpression[] => {
  const sites: CallExpression[] = [];
  const seen = new Set<string>();
  for (const reference of method.findReferencesAsNodes()) {
    const access = reference.getParent();
    if (access === undefined || !Node.isPropertyAccessExpression(access)) continue;
    if (access.getNameNode() !== reference) continue;
    const call = access.getParent();
    if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== access) {
      continue;
    }
    const key = `${call.getSourceFile().getFilePath()}:${call.getStart()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push(call);
  }
  return sites;
};

/**
 * The symbol an identifier stands for, which is not always the one it declares.
 *
 * `{ url }` both declares a property and names a value, and only the second is
 * the parameter an address came in on. Everywhere else the two are the same.
 */
const symbolBehind = (identifier: Identifier): TsSymbol | undefined => {
  const parent = identifier.getParent();
  if (Node.isShorthandPropertyAssignment(parent)) return parent.getValueSymbol();
  return identifier.getSymbol();
};

/**
 * Whether an argument is the object a method remembered its own parameters in.
 *
 * `connect(url, key) { this.params = { url, key }; this.open(this.params); }`
 * hands its caller's address on as surely as `this.open(url)` would, one field
 * and one literal further round. A wrapper doing that is still a wrapper, and
 * the address is still decided by whoever called it, so the trace has to keep
 * going out rather than stop at the object.
 */
export const remembersParametersOf = (argument: TsNode, method: ClassMethod): boolean => {
  const access = unwrap(argument);
  if (!Node.isPropertyAccessExpression(access)) return false;
  if (access.getExpression().getKind() !== SyntaxKind.ThisKeyword) return false;
  const object = objectWrittenTo(access.getName(), enclosingClass(access));
  return object !== undefined && readsParameterOf(object, method);
};

/**
 * Whether a value depends on what a method was called with.
 *
 * Looked for in the value and in the local bindings it names, since
 * `const url = this.url(path)` and then `http.get(url)` depends on `path` just as
 * much as writing it in place does. A shorthand property names a value rather
 * than declaring one, so it is asked for the value's symbol: `{ url }` depends
 * on `url` exactly as `{ url: url }` does.
 */
export const readsParameterOf = (value: TsNode, method: ClassMethod, budget = 4): boolean => {
  if (budget <= 0) return false;
  const parameters = new Set<TsNode>(parametersOf(method));
  const identifiers = Node.isIdentifier(value)
    ? [value]
    : value.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const identifier of identifiers) {
    const declaration = symbolBehind(identifier)?.getDeclarations()[0];
    if (declaration === undefined) continue;
    if (parameters.has(declaration)) return true;
    if (Node.isVariableDeclaration(declaration) && enclosingMethod(declaration) === method) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined && readsParameterOf(initializer, method, budget - 1)) {
        return true;
      }
    }
  }
  return false;
};

/**
 * The expressions a method answers with, however it was written.
 *
 * Three shapes, one question. A method and a block-bodied arrow answer with
 * their `return` statements; an arrow with no braces —
 * `url = (id) => `${base}/orders/${id}`` — answers with the expression it is,
 * and has no `return` anywhere to find. Asking for `ReturnStatement`
 * descendants of a field would find the ones inside the arrow when the filter
 * allows it and nothing at all when it does not, which reads as a method that
 * answers with nothing rather than one written differently.
 *
 * `nested` says whether returns written inside a function *inside* this one
 * count, which is the difference between "what does this answer with" and
 * "what values appear in it".
 */
const answersOf = (method: ClassMethod, nested = false): TsNode[] => {
  const fn = functionOf(method);
  if (fn === undefined) return [];
  const body = fn.getBody();
  if (body !== undefined && !Node.isBlock(body)) return [body];
  const statements = nested ? fn.getDescendantsOfKind(SyntaxKind.ReturnStatement) : ownReturns(fn);
  const answers: TsNode[] = [];
  for (const statement of statements) {
    const returned = statement.asKind(SyntaxKind.ReturnStatement)?.getExpression();
    if (returned !== undefined) answers.push(returned);
  }
  return answers;
};

/** The returns that belong to a function itself, not to one nested inside it. */
const ownReturns = (owner: TsNode): TsNode[] =>
  owner.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter((statement) => {
    const nearest = statement.getFirstAncestor(
      (ancestor) =>
        Node.isFunctionDeclaration(ancestor) ||
        Node.isMethodDeclaration(ancestor) ||
        Node.isArrowFunction(ancestor) ||
        Node.isFunctionExpression(ancestor) ||
        Node.isGetAccessorDeclaration(ancestor),
    );
    return nearest === owner;
  });

/**
 * Whether every value a piece of an address can take is a query string or
 * nothing.
 *
 * `/reviews${qs}` is the route `/reviews` whether `qs` is `''` or `?page=2`: a
 * query string is an argument to a route, not part of it. Where that is
 * provable — each branch a literal that is empty or opens with `?`, or a helper
 * whose every return is — the hole is dropped rather than left to make the whole
 * address unreadable. Anything the reader cannot prove stays a hole.
 */
const queryOnly = (value: TsNode, scope: Scope, budget: number): boolean => {
  if (budget <= 0) return false;
  const node = unwrap(value);

  const direct = evaluateExpression(node);
  if (direct.resolved) {
    return typeof direct.value === 'string' && (direct.value === '' || direct.value.startsWith('?'));
  }
  if (Node.isTemplateExpression(node)) return node.getHead().getLiteralText().startsWith('?');
  if (Node.isConditionalExpression(node)) {
    return (
      queryOnly(node.getWhenTrue(), scope, budget - 1) &&
      queryOnly(node.getWhenFalse(), scope, budget - 1)
    );
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return false;
    if (Node.isParameterDeclaration(declaration)) {
      const bound = scope.bound.get(declaration);
      return bound !== undefined && queryOnly(bound.node, bound.scope, budget - 1);
    }
    if (
      Node.isVariableDeclaration(declaration) &&
      declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
    ) {
      const initializer = declaration.getInitializer();
      return initializer !== undefined && queryOnly(initializer, scope, budget - 1);
    }
    return false;
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrap(node.getExpression());
    let answers: TsNode[] | undefined;
    let inside = scope;
    if (
      Node.isPropertyAccessExpression(callee) &&
      callee.getExpression().getKind() === SyntaxKind.ThisKeyword
    ) {
      for (const owner of chainFrom(scope, node)) {
        const method = methodNamedOn(owner, callee.getName());
        if (method === undefined || bodyOf(method) === undefined) continue;
        answers = answersOf(method);
        inside = { ...scope, bound: bindings(method, node, scope) };
        break;
      }
    } else if (Node.isIdentifier(callee)) {
      const declaration = callee.getSymbol()?.getDeclarations()[0];
      if (declaration !== undefined && Node.isFunctionDeclaration(declaration)) {
        answers = [];
        for (const statement of ownReturns(declaration)) {
          const returned = statement.asKind(SyntaxKind.ReturnStatement)?.getExpression();
          if (returned !== undefined) answers.push(returned);
        }
        inside = { ...scope, bound: NOTHING };
      }
    }
    if (answers === undefined) return false;
    return answers.length > 0 && answers.every((returned) => queryOnly(returned, inside, budget - 1));
  }
  return false;
};

/**
 * Whether the tail of an address is only ever a query string or nothing, read
 * where it is written with nothing bound.
 */
export const isQueryTail = (value: TsNode): boolean =>
  queryOnly(value, { readSetting: () => null, self: enclosingClass(value), bound: NOTHING }, BUDGET);

/** The key alone, for callers with nothing to do with the path. */
export const rootSettingKey = (value: TsNode, options: RootSettingOptions): string | null =>
  rootSettingAddress(value, options)?.key ?? null;

/** The parameter a value ultimately comes from, when it comes from one. */
export const parameterBehind = (value: TsNode, budget = BUDGET): ParameterDeclaration | undefined => {
  if (budget <= 0) return undefined;
  const node = unwrap(value);

  if (Node.isConditionalExpression(node)) {
    return (
      parameterBehind(node.getWhenTrue(), budget - 1) ??
      parameterBehind(node.getWhenFalse(), budget - 1)
    );
  }
  if (Node.isBinaryExpression(node)) {
    return (
      parameterBehind(node.getLeft(), budget - 1) ?? parameterBehind(node.getRight(), budget - 1)
    );
  }
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    return Node.isPropertyAccessExpression(callee) && PRESERVING.has(callee.getName())
      ? parameterBehind(callee.getExpression(), budget - 1)
      : undefined;
  }
  if (Node.isTemplateExpression(node)) {
    const spans = node.getTemplateSpans();
    if (node.getHead().getLiteralText() !== '' || spans.length !== 1) return undefined;
    return parameterBehind(spans[0]?.getExpression() ?? node, budget - 1);
  }
  if (!Node.isIdentifier(node)) return undefined;

  const declaration = node.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isParameterDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer === undefined ? undefined : parameterBehind(initializer, budget - 1);
  }
  return undefined;
};

/**
 * An address whose middle is filled in by whoever makes the request.
 *
 * A shared client writes `${this.baseUrl}${path}` once: the base is settled
 * where the client was built, and the path only exists at the call sites. The
 * two halves have to be put back together, so both are carried here.
 */
export interface SplitAddress {
  parameter: ParameterDeclaration;
  /** Settings key the fixed half is rooted at, when it is rooted at one. */
  baseUrlEnv: string | null;
  /** Literal text before and after the part the caller supplies. */
  before: string;
  after: string;
}

/**
 * Splits an address at the one piece the caller decides.
 *
 * Exactly one hole is allowed. Two would mean guessing which caller argument
 * fills which, and a guess here becomes an edge claiming one service calls
 * another, which is precisely the claim that has to be right.
 */
export const splitAtParameter = (
  value: TsNode,
  options: RootSettingOptions,
): SplitAddress | undefined => {
  const budget = options.budget ?? BUDGET;
  const node = deref(value, budget);

  // The whole address is the parameter.
  const whole = parameterBehind(node, budget);
  if (whole !== undefined) return { parameter: whole, baseUrlEnv: null, before: '', after: '' };

  if (!Node.isTemplateExpression(node)) return undefined;

  const spans = node.getTemplateSpans();
  let baseUrlEnv: string | null = null;
  let text = node.getHead().getLiteralText();
  let start = 0;

  // An address that opens with an interpolation opens with its base. Whether
  // the base can be named or not, it is not part of the path: writing an
  // unreadable base in as a path segment would invent a route.
  const first = spans[0];
  if (
    text === '' &&
    first !== undefined &&
    parameterBehind(first.getExpression(), budget) === undefined
  ) {
    const literal = evaluateExpression(first.getExpression());
    if (!(literal.resolved && typeof literal.value === 'string')) {
      baseUrlEnv = rootSettingKey(first.getExpression(), options);
      text = first.getLiteral().getLiteralText();
      start = 1;
    }
  }

  let split: SplitAddress | undefined;
  for (let index = start; index < spans.length; index += 1) {
    const span = spans[index];
    if (span === undefined) continue;
    const literal = span.getLiteral().getLiteralText();
    const parameter = parameterBehind(span.getExpression(), budget);

    if (parameter !== undefined) {
      if (split !== undefined) return undefined;
      split = { parameter, baseUrlEnv, before: text, after: literal };
      text = '';
      continue;
    }
    const value = evaluateExpression(span.getExpression());
    const hole = holeIn(split === undefined ? text : split.after, literal, index === spans.length - 1);
    const piece = value.resolved && typeof value.value === 'string' ? value.value : hole;
    if (split === undefined) text += piece + literal;
    else split.after += piece + literal;
  }
  return split;
};

export interface ForwardedCall {
  /** The call that supplies the value, one hop out from where it was needed. */
  site: TsNode;
  /** What was passed there. */
  argument: TsNode;
}

/**
 * Finds who supplies what reaches a function as a parameter.
 *
 * A request made inside a shared client is written once and made from many
 * places, so the address only exists at the call sites. Following the parameter
 * outward is what turns one unreadable request into one readable request per
 * caller, which is the difference between a wrapper and a dead end. A caller
 * that is itself forwarding is followed further, so a client layered on a
 * transport still lands on the service that wanted the data.
 */
export const forwardedFrom = (parameter: ParameterDeclaration, budget = 4): ForwardedCall[] => {
  if (budget <= 0) return [];
  const method = methodHolding(parameter);
  if (method === undefined) return [];
  const index = parametersOf(method).findIndex((item) => item === parameter);
  if (index < 0) return [];

  const out: ForwardedCall[] = [];
  const seen = new Set<string>();
  for (const reference of method.findReferencesAsNodes()) {
    const parent = reference.getParent();
    const call =
      parent !== undefined && Node.isPropertyAccessExpression(parent) ? parent.getParent() : parent;
    if (call === undefined || !Node.isCallExpression(call)) continue;
    const argument = call.getArguments()[index];
    if (argument === undefined) continue;

    const key = `${call.getSourceFile().getFilePath()}:${call.getStart()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // A caller that is itself forwarding is not where the address is decided.
    // If nothing calls it either, the whole chain is unused and this hop stands
    // for nobody, so it is dropped rather than recorded as a request.
    const further = parameterBehind(argument, budget);
    if (further !== undefined) {
      out.push(...forwardedFrom(further, budget - 1));
      continue;
    }
    out.push({ site: call, argument });
  }
  return out;
};

/** True when a value can be read where it stands, with no caller needed. */
export const isReadable = (value: TsNode): boolean => {
  const node = deref(value);
  if (Node.isTemplateExpression(node)) {
    return node
      .getTemplateSpans()
      .every((span) => parameterBehind(span.getExpression()) === undefined);
  }
  // `deref` leaves a name that can be reassigned alone, and what it was first
  // given is not what it holds here.
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isVariableDeclaration(declaration)) return false;
  }
  return evaluateExpression(node).resolved;
};

/**
 * The constant a method always answers with, when it always answers the same.
 *
 * A set of services written on a shared base names its own slice of the API in
 * an override: `getResourcePath() { return 'categories'; }`. That is a constant
 * wearing a method's clothes, and reading it is the difference between knowing
 * a path and recording a hole where its middle should be.
 *
 * Only a method whose every return is the same literal counts. One that decides
 * at run time is a hole, and saying otherwise would invent a route.
 */
export const constantMethodResult = (node: TsNode): string | null => {
  const call = unwrap(node);
  if (!Node.isCallExpression(call) || call.getArguments().length > 0) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return null;

  for (const owner of classChain(enclosingClass(call))) {
    const method = methodNamedOn(owner, callee.getName());
    if (method === undefined) continue;
    const answers = answersOf(method, true);
    if (answers.length === 0) continue;

    const values = new Set<string>();
    for (const expression of answers) {
      const value = evaluateExpression(expression);
      if (!value.resolved || typeof value.value !== 'string') return null;
      values.add(value.value);
    }
    return values.size === 1 ? [...values][0]! : null;
  }
  return null;
};

/**
 * The one expression a no-argument method answers with, when there is one.
 *
 * A service that assembles its own address usually does it in a private helper
 * and calls that everywhere. The helper is not a hole: it is the first half of
 * every address the service uses, and the caller can read it the same way it
 * reads anything else.
 */
export const returnedExpression = (node: TsNode): TsNode | null => {
  const call = unwrap(node);
  if (!Node.isCallExpression(call) || call.getArguments().length > 0) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return null;

  for (const owner of classChain(enclosingClass(call))) {
    const method = methodNamedOn(owner, callee.getName());
    if (method === undefined) continue;
    const answers = answersOf(method, true);
    // Nothing to read is not an answer of its own: a base class along the chain
    // may declare the method this one only names.
    if (answers.length === 0) continue;
    return answers.length === 1 ? (answers[0] ?? null) : null;
  }
  return null;
};

/** A lookup into a fixed table of strings, and every value it can give. */
export interface FiniteLookup {
  node: TsNode;
  values: string[];
}

/**
 * The most values one hole may stand for before enumerating stops being useful.
 *
 * One number for every reader that turns a hole into a set: a table looked up,
 * a parameter typed as a union, a value folded from one, and the channels an
 * address then names. Past a dozen the set is a domain rather than a choice —
 * a currency, a locale, a status — and the hole is better read as the hole it
 * is. Exported so the broker does not keep a second copy of the same judgement
 * (R42).
 */
export const MOST_CHOICES = 12;

/** The object a table expression always holds, when it is written down whole. */
const tableOf = (expression: TsNode): Record<string, unknown> | null => {
  const node = unwrap(expression);
  const value = evaluateExpression(node);
  if (value.resolved) {
    return value.value !== null && typeof value.value === 'object' && !Array.isArray(value.value)
      ? (value.value as Record<string, unknown>)
      : null;
  }
  // `private readonly paths = { ... }` is a table kept in a field, which the
  // evaluator does not follow; a field nothing reassigns holds its initializer.
  if (Node.isPropertyAccessExpression(node) && node.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined || !Node.isPropertyDeclaration(declaration)) return null;
    if (!declaration.isReadonly()) return null;
    const initializer = declaration.getInitializer();
    return initializer === undefined ? null : tableOf(initializer);
  }
  return null;
};

/**
 * Every lookup into a fixed table an address depends on.
 *
 * `ENTITY_PATH[entityType]` is not a value filling a route parameter: it is one
 * of the handful of segments the table spells out. The table is written down, so
 * the segments can be listed; when the key is typed as a union of literals only
 * the entries it can name are. The request reaches one of them per run, and the
 * reader is the one who has to say which edges that makes, so each value comes
 * back and nothing is picked.
 */
export const finiteLookups = (value: TsNode, budget = 4): FiniteLookup[] => {
  const found = new Map<TsNode, string[]>();
  const visit = (node: TsNode, left: number): void => {
    if (left <= 0) return;
    const candidates = Node.isElementAccessExpression(node)
      ? [node, ...node.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)]
      : node.getDescendantsOfKind(SyntaxKind.ElementAccessExpression);
    for (const access of candidates) {
      if (found.has(access) || !Node.isElementAccessExpression(access)) continue;
      const table = tableOf(access.getExpression());
      const key = access.getArgumentExpression();
      if (table === null || key === undefined) continue;
      const entries = Object.entries(table);
      if (entries.length === 0 || entries.some(([, item]) => typeof item !== 'string')) continue;
      const keyType = key.getType();
      const named = keyType.isUnion()
        ? keyType.getUnionTypes()
        : keyType.isStringLiteral()
          ? [keyType]
          : [];
      const keys = named.every((member) => member.isStringLiteral())
        ? new Set(named.map((member) => String(member.getLiteralValue())))
        : new Set<string>();
      const values = [
        ...new Set(
          entries
            .filter(([name]) => keys.size === 0 || keys.has(name))
            .map(([, item]) => item as string),
        ),
      ].sort();
      if (values.length === 0 || values.length > MOST_CHOICES) continue;
      found.set(access, values);
    }
    const identifiers = Node.isIdentifier(node)
      ? [node]
      : node.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const identifier of identifiers) {
      const declaration = identifier.getSymbol()?.getDeclarations()[0];
      if (declaration === undefined || !Node.isVariableDeclaration(declaration)) continue;
      if (declaration.getSourceFile() !== node.getSourceFile()) continue;
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) visit(initializer, left - 1);
    }
  };
  visit(value, budget);
  return [...found].map(([node, values]) => ({ node, values }));
};

/**
 * Every segment of an address whose type is a closed set of strings.
 *
 * The other half of `finiteLookups`, and deliberately a second function rather
 * than another branch inside it. A table written down is a fact about a value;
 * this is a fact about a type, it is read differently, and it is asked only
 * where the table search found nothing — so a project with neither pays for
 * neither (R31).
 *
 * `decide(id: string, action: 'ship' | 'refund')` writing
 * `` `/orders/${id}/${action}` `` is two addresses, both of them real, each
 * reaching a route that exists. Read as one `:param` it matched neither.
 */
export const literalChoices = (value: TsNode, max = MOST_CHOICES): FiniteLookup[] => {
  const found = new Map<TsNode, string[]>();
  const identifiers = Node.isIdentifier(value)
    ? [value]
    : value.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const identifier of identifiers) {
    if (found.has(identifier)) continue;
    // A name that stands for a value, not one that is part of an access or a
    // call: `order.status` names a property and `f(x)` names a function, and
    // neither is a segment this can enumerate.
    const parent = identifier.getParent();
    if (parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) {
      continue;
    }
    const declaration = identifier.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined || !Node.isParameterDeclaration(declaration)) continue;
    const members = literalUnionOf(identifier, max);
    if (members !== null && members.length > 1) found.set(identifier, [...members].sort());
  }
  return [...found].map(([node, values]) => ({ node, values }));
};

/**
 * String operations this folds. Deliberately a closed set of pure, total
 * methods whose result depends only on the receiver and literal arguments —
 * add to it only when a real project needs the addition (R42).
 */
const FOLDABLE = new Set([
  'slice',
  'substring',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimStart',
  'trimEnd',
  'replace',
  'replaceAll',
]);

/**
 * Longest value folding will carry, checked on the way IN and on the way OUT.
 *
 * Bounding the input bounds the work a pathological source regex can do on it.
 * Bounding the output is what stops a chain growing without limit — a `replace`
 * that doubles its receiver is under the cap at every individual step and over
 * it after a few, and the last step in a chain has nothing after it to notice.
 *
 * It is not a runtime bound. A catastrophically backtracking pattern from the
 * source (`/(a+)+b/`) against a 200-character receiver is still slow; the cap
 * makes it bounded-slow rather than unbounded. Acceptable for a tool run by
 * hand over a repository you own; it would not be for untrusted input.
 */
const LONGEST_FOLD = 200;

/** A literal argument to a folded call: a string, a number, or a regex. */
const literalArgOf = (node: TsNode): string | number | RegExp | null => {
  const expr = unwrap(node);
  const value = evaluateExpression(expr);
  if (value.resolved && (typeof value.value === 'string' || typeof value.value === 'number')) {
    return value.value;
  }
  // `'TICKET_'.length` is a literal length written readably; the evaluator
  // does not fold it, and refusing it here would refuse the common spelling.
  if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'length') {
    const receiver = evaluateExpression(expr.getExpression());
    if (receiver.resolved && typeof receiver.value === 'string') return receiver.value.length;
  }
  if (Node.isRegularExpressionLiteral(expr)) {
    const text = expr.getLiteralText();
    const end = text.lastIndexOf('/');
    if (end <= 0) return null;
    try {
      return new RegExp(text.slice(1, end), text.slice(end + 1));
    } catch {
      return null;
    }
  }
  return null;
};

/** One folded step. Returns null when the operation cannot be applied exactly. */
const applyFold = (input: string, name: string, args: (string | number | RegExp)[]): string | null => {
  if (input.length > LONGEST_FOLD) return null;
  const bounded = (value: string | null): string | null =>
    value !== null && value.length <= LONGEST_FOLD ? value : null;
  const [first, second] = args;
  switch (name) {
    case 'toLowerCase':
      return args.length === 0 ? bounded(input.toLowerCase()) : null;
    case 'toUpperCase':
      return args.length === 0 ? bounded(input.toUpperCase()) : null;
    case 'trim':
      return args.length === 0 ? bounded(input.trim()) : null;
    case 'trimStart':
      return args.length === 0 ? bounded(input.trimStart()) : null;
    case 'trimEnd':
      return args.length === 0 ? bounded(input.trimEnd()) : null;
    case 'slice':
    case 'substring': {
      if (typeof first !== 'number') return null;
      if (second !== undefined && typeof second !== 'number') return null;
      return bounded(
        name === 'slice'
          ? input.slice(first, second as number | undefined)
          : input.substring(first, second as number | undefined),
      );
    }
    case 'replace':
    case 'replaceAll': {
      if (typeof second !== 'string') return null;
      if (typeof first === 'string') {
        return bounded(name === 'replace' ? input.replace(first, second) : input.replaceAll(first, second));
      }
      if (first instanceof RegExp) {
        // `replaceAll` demands a global pattern; `replace` accepts either.
        if (name === 'replaceAll' && !first.flags.includes('g')) return null;
        return bounded(input.replace(first, second));
      }
      return null;
    }
    default:
      return null;
  }
};

/**
 * Every value an expression can hold, when that set is finite and readable.
 *
 * A name computed from a closed set of strings still holds a closed set of
 * strings. `type.slice('TICKET_'.length).toLowerCase().replace(/_/g, '-')`
 * over `'TICKET_OPENED' | 'TICKET_ON_HOLD' | 'TICKET_CLOSED'` is three
 * values, all of them knowable without running anything — so a template hole
 * filled by it is not a hole (R42).
 *
 * Returns null the moment a step cannot be applied exactly. Folding a value
 * half-way and guessing the rest would put a channel in the graph that no
 * service publishes to, which is worse than the wildcard it replaces.
 */
const foldValues = (node: TsNode, max: number, budget: number): string[] | null => {
  if (budget <= 0) return null;
  const expr = unwrap(node);

  const direct = evaluateExpression(expr);
  if (direct.resolved && typeof direct.value === 'string') return [direct.value];

  // The type is the best annotation there is: it is checked, it is renamed with
  // its members, and it cannot drift from the code because it is the code.
  // Asked of every expression rather than only of a name, so that typing the
  // value works wherever the value is written — a local, a call's return, or
  // the call written straight into the template. Asking only of identifiers
  // made the advice "give it a union type" depend on whether you had also
  // assigned it to a variable, which is not a difference anybody means.
  const byType = literalUnionOf(expr, max);
  if (byType !== null && byType.length > 0) return [...byType];

  if (Node.isIdentifier(expr)) {
    const declaration = expr.getSymbol()?.getDeclarations()[0];
    // `const` only. A `let` the code reassigns holds its initializer at exactly
    // one point in the program, and folding it would answer with the first
    // value and silently drop the rest — a confident wrong channel, which this
    // function's own contract says is worse than the hole it replaces.
    if (
      declaration !== undefined &&
      Node.isVariableDeclaration(declaration) &&
      declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
    ) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return foldValues(initializer, max, budget - 1);
    }
    return null;
  }

  if (Node.isCallExpression(expr)) {
    const callee = unwrap(expr.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) return null;
    const name = callee.getName();
    if (!FOLDABLE.has(name)) return null;
    const base = foldValues(callee.getExpression(), max, budget - 1);
    if (base === null || base.length > max) return null;
    const args: (string | number | RegExp)[] = [];
    for (const argument of expr.getArguments()) {
      const literal = literalArgOf(argument);
      if (literal === null) return null;
      args.push(literal);
    }
    const folded: string[] = [];
    for (const value of base) {
      const next = applyFold(value, name, args);
      if (next === null) return null;
      folded.push(next);
    }
    return [...new Set(folded)];
  }

  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '+') {
    const left = foldValues(expr.getLeft(), max, budget - 1);
    const right = foldValues(expr.getRight(), max, budget - 1);
    if (left === null || right === null) return null;
    if (left.length * right.length > max) return null;
    const joined = [...new Set(left.flatMap((a) => right.map((b) => a + b)))];
    return joined.some((each) => each.length > LONGEST_FOLD) ? null : joined;
  }

  return null;
};

/**
 * The values a template hole can hold, or null when that is not a finite set.
 *
 * The third reader beside `finiteLookups` (a fact about a written-down table)
 * and `literalChoices` (a fact about a parameter's type): this is a fact about
 * a computation over one of those, and it is asked where both found nothing.
 */
export const foldedChoices = (value: TsNode, max = MOST_CHOICES): string[] | null => {
  const folded = foldValues(value, max, BUDGET);
  if (folded === null || folded.length === 0 || folded.length > max) return null;
  return [...folded].sort();
};
