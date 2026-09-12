import type {
  CallExpression,
  MethodDeclaration,
  ParameterDeclaration,
  TemplateExpression,
  Node as TsNode,
} from 'ts-morph';
import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';
import { holeIn, UNREAD_SPAN } from './ids.js';
import { evaluateExpression } from './static-value.js';

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

  for (const constructor of declaration.getConstructors()) {
    const body = constructor.getBody();
    if (body === undefined) continue;
    for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      const left = assignment.getLeft();
      if (!Node.isPropertyAccessExpression(left)) continue;
      if (left.getName() !== name) continue;
      if (left.getExpression().getKind() !== SyntaxKind.ThisKeyword) continue;
      found.push(assignment.getRight());
    }
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
  method: MethodDeclaration,
  call: CallExpression,
  scope: Scope,
): ReadonlyMap<ParameterDeclaration, Bound> => {
  const bound = new Map<ParameterDeclaration, Bound>();
  const args = call.getArguments();
  method.getParameters().forEach((parameter, index) => {
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
    const answer = constantReturnOf(owner.getMethod(callee.getName()));
    if (answer !== null) return answer;
  }
  return null;
};

/** The one string every return of a method gives, when they all give the same. */
const constantReturnOf = (method: MethodDeclaration | undefined): string | null => {
  if (method === undefined) return null;
  const returns = method.getDescendantsOfKind(SyntaxKind.ReturnStatement);
  if (returns.length === 0) return null;
  const values = new Set<string>();
  for (const statement of returns) {
    const expression = statement.getExpression();
    if (expression === undefined) return null;
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
export const constantPropertyValue = (node: TsNode): string | null => {
  const access = unwrap(node);
  if (!Node.isPropertyAccessExpression(access)) return null;
  if (access.getExpression().getKind() !== SyntaxKind.ThisKeyword) return null;
  const values = new Set<string>();
  for (const assigned of assignmentsTo(access.getName(), enclosingClass(access))) {
    const value = evaluateExpression(assigned);
    if (!value.resolved || typeof value.value !== 'string') return null;
    if (ABSOLUTE.test(value.value)) return null;
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
    const method = owner.getMethod(callee.getName());
    if (method === undefined) continue;
    return method.isAbstract() || method.getBody() === undefined;
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
  const hole = (node: TsNode): string =>
    choosesASegment(node) ? UNREAD_SPAN : holeIn(before, after, last);
  if (budget <= 0) return hole(value);

  const node = unwrap(value);
  if (Node.isTemplateExpression(node)) {
    const spans = node.getTemplateSpans();
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
  return hole(node);
};

/** The literal text a template writes after the hole at `from`, holes included. */
const tailFrom = (
  template: TemplateExpression,
  from: number,
  scope: Scope,
  budget: number,
): string => {
  const spans = template.getTemplateSpans();
  let text = spans[from]?.getLiteral().getLiteralText() ?? '';
  for (let index = from + 1; index < spans.length; index += 1) {
    const span = spans[index];
    if (span === undefined) continue;
    const literal = span.getLiteral().getLiteralText();
    const last = index === spans.length - 1;
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
    if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return null;
    for (const owner of chainFrom(scope, node)) {
      const method = owner.getMethod(callee.getName());
      if (method === undefined) continue;
      const inside: Scope = { ...scope, bound: bindings(method, node, scope) };
      for (const statement of method.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
        const returned = statement.getExpression();
        if (returned === undefined) continue;
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
      const right = readString(node.getRight(), scope, budget - 1);
      return { ...left, prefix: left.prefix + (right ?? holeIn(left.prefix, '', true)) };
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
  options: RootSettingOptions,
): SettingAddress | null =>
  addressOf(
    value,
    { readSetting: options.readSetting, self: enclosingClass(value), bound: NOTHING },
    options.budget ?? BUDGET,
  );

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
  const owner = parameter.getParent();
  const method = owner?.asKind(SyntaxKind.MethodDeclaration);
  if (method === undefined) return [];
  const index = method.getParameters().findIndex((item) => item === parameter);
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
    const method = owner.getMethod(callee.getName());
    if (method === undefined) continue;
    const returns = method.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    if (returns.length === 0) continue;

    const values = new Set<string>();
    for (const statement of returns) {
      const expression = statement.getExpression();
      if (expression === undefined) return null;
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
    const method = owner.getMethod(callee.getName());
    if (method === undefined) continue;
    const returns = method.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    if (returns.length !== 1) return null;
    return returns[0]?.getExpression() ?? null;
  }
  return null;
};
