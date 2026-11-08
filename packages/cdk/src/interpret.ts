import { dirname, posix, relative, resolve as resolvePath } from 'node:path';
import { evaluateExpression, startLineOf, toPosixPath, type Unresolved } from '@flowatlas/core';
import { Node, SyntaxKind, type ClassDeclaration, type ClassExpression, type SourceFile, type Node as TsNode } from 'ts-morph';
import { cdkModuleOf, CONSTRUCT_BASES, isPathModule } from './modules.js';
import { importedParameter, staticCall, staticValue } from './statics.js';
import { chainMethod, isChainable } from './chains.js';
import { constructMethod, constructProperty } from './construct-methods.js';
import {
  Attribute,
  Built,
  CdkRef,
  ClassValue,
  Construct,
  EXPORT_VALUE,
  FunctionValue,
  NodeHandle,
  ObjectValue,
  Scope,
  textOf,
  toJson,
  Unread,
  type Site,
  type Value,
} from './values.js';

/**
 * A CDK app, run in the reader's head (P57, D4).
 *
 * Constructs are made inside constructors, helper functions and loops, and
 * handed to each other as values: `new SqsEventSource(queue)`,
 * `api.root.addResource('orders')`. Which queue a mapping reads and which path
 * a resource has is only known by following the values, so the app is read the
 * way it runs: from its first statement, with `this` as the construct being
 * built, parameters bound to what each call hands them, constants and imports
 * followed across files, loops over arrays the files settle taken once per
 * element, and conditions the files settle decided.
 *
 * What the files do not settle is never filled in. A value read from an
 * argument nobody passes, a loop over a collection read from the environment, a
 * token the deployment fills in, is an {@link Unread} carried where the value
 * would have gone; a construct declared under a condition that is not settled
 * is read, and says it may not be deployed; one declared per element of an
 * unread collection is read once, and says so. The walk is bounded in depth and
 * in steps, and a bound reached is a row rather than a hang.
 */

/** How deep calls may nest, and how many expressions one app may take. */
const MOST_DEPTH = 48;
const MOST_STEPS = 400_000;
/** How many elements of a settled array a loop is taken for. */
const MOST_ELEMENTS = 64;

/** What a body runs inside. */
export interface Frame {
  /** `this`: the construct being built, when there is one. */
  readonly self?: Construct;
  /** The class whose constructor or method is running, for `super`. */
  readonly cls?: ClassDeclaration | ClassExpression;
  /** The condition everything here is declared under, when the files do not settle it. */
  readonly conditional?: string;
  /** The collection everything here is declared once per element of, when the files do not settle it. */
  readonly repeated?: string;
  /**
   * Where the helper function this runs inside was called from, outermost
   * first: a construct a helper makes for its caller is placed at the call, so
   * fourteen functions made by one helper are fourteen lines, not one.
   */
  readonly at?: Site;
}

/** How a body ended: by a `return`, with its value. */
interface Completion {
  readonly returned: boolean;
  readonly value: Value;
}

const NORMAL: Completion = { returned: false, value: undefined };

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
};

const truthy = (value: Value): boolean | undefined => {
  if (value instanceof Unread) return undefined;
  if (value === undefined || value === null || value === false || value === 0 || value === '') return false;
  if (typeof value === 'string' || typeof value === 'number' || value === true) return true;
  if (value instanceof Attribute || value instanceof Built || value instanceof CdkRef) return undefined;
  return true;
};

export interface AppReading {
  /** Absolute path of the repository. */
  readonly repoDir: string;
  /** The context the app reads with `tryGetContext`: `cdk.json`'s, under the configured options. */
  readonly context: Readonly<Record<string, unknown>>;
}

export class Interpreter {
  readonly constructs: Construct[] = [];
  readonly rows: Unresolved[] = [];
  /** Every class of the app something created. */
  readonly instantiated = new Set<TsNode>();
  readonly #modules = new Map<TsNode, Value>();
  #steps = 0;
  #depth = 0;
  #stopped = false;

  constructor(readonly app: AppReading) {}

  /**
   * Where something made at a node is placed: at the call of the helper that
   * made it, when the helper is written in the same file, so that each of the
   * functions one local helper makes has a line of its own; otherwise where it
   * is made, which is the file that declares it.
   */
  #placed(node: TsNode, frame: Frame): Site {
    const own = this.site(node);
    return frame.at !== undefined && frame.at.file === own.file ? frame.at : own;
  }

  site(node: TsNode): Site {
    return { file: toPosixPath(relative(this.app.repoDir, node.getSourceFile().getFilePath())), line: startLineOf(node) };
  }

  #bound(node: TsNode, what: string): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.rows.push({
      ...this.site(node),
      reason: 'deployment-app-unread',
      message: `the app was read as far as ${shorten(node.getText())}, where ${what}; what it declares after that is not read`,
      hint: 'A bound on how far the app is followed was reached. Report it with the line if the app is not unusually large or recursive.',
    });
  }

  // ------------------------------------------------------------- running

  /** Runs a module from its first statement: the app's entry. */
  runModule(source: SourceFile): void {
    this.#block(source.getStatements(), new Scope(), {});
  }

  /** A class of the app made on its own, with nothing it is handed read: what an app that is not read still declares. */
  instantiateAlone(cls: ClassDeclaration, app: Construct): void {
    const id = cls.getName() ?? 'Stack';
    this.#instantiate(new ClassValue(cls), [app, id, new Unread(`what ${id} is handed is not read`, 'app-unread')], cls, {});
  }

  #block(statements: readonly TsNode[], scope: Scope, frame: Frame): Completion {
    for (const statement of statements) {
      const done = this.#statement(statement, scope, frame);
      if (done.returned) return done;
    }
    return NORMAL;
  }

  #statement(node: TsNode, scope: Scope, frame: Frame): Completion {
    if (this.#stopped) return NORMAL;
    if (Node.isVariableStatement(node)) {
      for (const declaration of node.getDeclarations()) {
        const initializer = declaration.getInitializer();
        const value = initializer === undefined ? undefined : this.value(initializer, scope, frame);
        this.#bind(declaration.getNameNode(), value, scope, frame);
        // A module's own constant, met again by a function that names it, is the one already made.
        if (Node.isSourceFile(node.getParent())) this.#modules.set(declaration, value);
      }
      return NORMAL;
    }
    if (Node.isExpressionStatement(node)) {
      this.value(node.getExpression(), scope, frame);
      return NORMAL;
    }
    if (Node.isReturnStatement(node)) {
      const expression = node.getExpression();
      return { returned: true, value: expression === undefined ? undefined : this.value(expression, scope, frame) };
    }
    if (Node.isBlock(node)) return this.#block(node.getStatements(), new Scope(scope), frame);
    if (Node.isIfStatement(node)) {
      const condition = this.value(node.getExpression(), scope, frame);
      const settled = truthy(condition);
      const otherwise = node.getElseStatement();
      if (settled === true) return this.#statement(node.getThenStatement(), new Scope(scope), frame);
      if (settled === false) return otherwise === undefined ? NORMAL : this.#statement(otherwise, new Scope(scope), frame);
      const text = shorten(node.getExpression().getText());
      const then = this.#statement(node.getThenStatement(), new Scope(scope), this.#under(frame, text));
      const other = otherwise === undefined ? NORMAL : this.#statement(otherwise, new Scope(scope), this.#under(frame, `!(${text})`));
      return then.returned && other.returned ? then : NORMAL;
    }
    if (Node.isForOfStatement(node)) {
      const items = this.value(node.getExpression(), scope, frame);
      const initializer = node.getInitializer();
      const binding = Node.isVariableDeclarationList(initializer) ? initializer.getDeclarations()[0]?.getNameNode() : undefined;
      if (Array.isArray(items) && items.length <= MOST_ELEMENTS) {
        for (const item of items) {
          const inner = new Scope(scope);
          if (binding !== undefined) this.#bind(binding, item, inner, frame);
          const done = this.#statement(node.getStatement(), inner, frame);
          if (done.returned) return done;
        }
        return NORMAL;
      }
      const inner = new Scope(scope);
      const text = shorten(node.getExpression().getText());
      if (binding !== undefined) this.#bind(binding, new Unread(`an element of ${text}, which the files do not settle`, 'repeated'), inner, frame);
      return this.#statement(node.getStatement(), inner, { ...frame, repeated: text });
    }
    if (Node.isForStatement(node) || Node.isForInStatement(node) || Node.isWhileStatement(node) || Node.isDoStatement(node)) {
      return this.#statement(node.getStatement(), new Scope(scope), { ...frame, repeated: shorten(node.getText().split('{')[0] ?? node.getText()) });
    }
    if (Node.isTryStatement(node)) return this.#block(node.getTryBlock().getStatements(), new Scope(scope), frame);
    if (Node.isSwitchStatement(node)) {
      const text = shorten(node.getExpression().getText());
      for (const clause of node.getClauses()) this.#block(clause.getStatements(), new Scope(scope), this.#under(frame, text));
      return NORMAL;
    }
    if (Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (name !== undefined) scope.set(name, new FunctionValue(node, scope));
      return NORMAL;
    }
    if (Node.isClassDeclaration(node)) {
      const name = node.getName();
      if (name !== undefined) scope.set(name, new ClassValue(node));
      return NORMAL;
    }
    return NORMAL;
  }

  #under(frame: Frame, condition: string): Frame {
    return { ...frame, conditional: frame.conditional === undefined ? condition : `${frame.conditional} && ${condition}` };
  }

  /** Binds a name or a destructuring pattern to a value. */
  #bind(name: TsNode, value: Value, scope: Scope, frame: Frame): void {
    if (Node.isIdentifier(name)) {
      scope.set(name.getText(), value);
      return;
    }
    if (Node.isObjectBindingPattern(name)) {
      for (const element of name.getElements()) {
        const key = element.getPropertyNameNode()?.getText() ?? element.getName();
        let member = value instanceof ObjectValue ? value.get(key) : value instanceof Unread ? value : new Unread(`${key} of a value that is not an object`, 'not-an-object');
        const fallback = element.getInitializer();
        if (member === undefined && fallback !== undefined) member = this.value(fallback, scope, frame);
        this.#bind(element.getNameNode(), member, scope, frame);
      }
      return;
    }
    if (Node.isArrayBindingPattern(name)) {
      name.getElements().forEach((element, index) => {
        if (Node.isBindingElement(element)) this.#bind(element.getNameNode(), Array.isArray(value) ? value[index] : value instanceof Unread ? value : undefined, scope, frame);
      });
    }
  }

  // ---------------------------------------------------------- expressions

  value(node: TsNode, scope: Scope, frame: Frame): Value {
    if (this.#stopped) return new Unread('the app was not read this far', 'bound');
    this.#steps += 1;
    if (this.#steps > MOST_STEPS) {
      this.#bound(node, 'the reading took more steps than an app is given');
      return new Unread('the app was not read this far', 'bound');
    }
    if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node) || Node.isSatisfiesExpression(node) || Node.isTypeAssertion(node)) {
      return this.value(node.getExpression(), scope, frame);
    }
    if (Node.isAwaitExpression(node)) return this.value(node.getExpression(), scope, frame);
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
    if (Node.isNumericLiteral(node)) return node.getLiteralValue();
    if (Node.isTrueLiteral(node)) return true;
    if (Node.isFalseLiteral(node)) return false;
    if (node.getKind() === SyntaxKind.NullKeyword) return null;
    if (node.getKind() === SyntaxKind.ThisKeyword) return frame.self ?? new Unread('this, outside a construct', 'this');
    if (Node.isTemplateExpression(node)) return this.#template(node, scope, frame);
    if (Node.isIdentifier(node)) return this.#name(node, scope, frame);
    if (Node.isPropertyAccessExpression(node)) return this.#property(node, scope, frame);
    if (Node.isElementAccessExpression(node)) {
      const owner = this.value(node.getExpression(), scope, frame);
      const argument = node.getArgumentExpression();
      const key = argument === undefined ? undefined : this.value(argument, scope, frame);
      if (Array.isArray(owner) && typeof key === 'number') return owner[key];
      return typeof key === 'string' ? this.member(owner, key, node) : new Unread(`${shorten(node.getText())} is read by a key the files do not settle`, 'dynamic-key');
    }
    if (Node.isObjectLiteralExpression(node)) return this.#object(node, scope, frame);
    if (Node.isArrayLiteralExpression(node)) {
      const items: Value[] = [];
      for (const element of node.getElements()) {
        if (Node.isSpreadElement(element)) {
          const spread = this.value(element.getExpression(), scope, frame);
          if (Array.isArray(spread)) items.push(...spread);
          else items.push(spread instanceof Unread ? spread : new Unread(`${shorten(element.getText())} is not a list`, 'not-a-list'));
        } else items.push(this.value(element, scope, frame));
      }
      return items;
    }
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return new FunctionValue(node, scope);
    if (Node.isClassExpression(node)) return new ClassValue(node);
    if (Node.isBinaryExpression(node)) return this.#binary(node, scope, frame);
    if (Node.isPrefixUnaryExpression(node)) {
      const operand = this.value(node.getOperand(), scope, frame);
      if (node.getOperatorToken() === SyntaxKind.ExclamationToken) {
        const settled = truthy(operand);
        return settled === undefined ? new Unread(`${shorten(node.getText())} is not settled`, 'condition') : !settled;
      }
      if (node.getOperatorToken() === SyntaxKind.MinusToken && typeof operand === 'number') return -operand;
      return new Unread(`${shorten(node.getText())} is not read`, 'operator');
    }
    if (Node.isConditionalExpression(node)) {
      const settled = truthy(this.value(node.getCondition(), scope, frame));
      if (settled === true) return this.value(node.getWhenTrue(), scope, frame);
      if (settled === false) return this.value(node.getWhenFalse(), scope, frame);
      return new Unread(`${shorten(node.getText())} depends on a condition the files do not settle`, 'condition');
    }
    if (Node.isNewExpression(node)) return this.#new(node, scope, frame);
    if (Node.isCallExpression(node)) return this.#call(node, scope, frame);
    if (Node.isTypeOfExpression(node)) return new Unread('typeof is not read', 'operator');
    return new Unread(`${shorten(node.getText())} is not read`, 'not-read');
  }

  #template(node: TsNode & { getHead(): TsNode & { getLiteralText(): string }; getTemplateSpans(): TsNode[] }, scope: Scope, frame: Frame): Value {
    let text = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) {
      if (!Node.isTemplateSpan(span)) continue;
      const part = this.value(span.getExpression(), scope, frame);
      if (typeof part !== 'string' && typeof part !== 'number' && typeof part !== 'boolean') {
        return part instanceof Unread
          ? new Unread(`${shorten(node.getText())} holds ${part.text}`, part.reason)
          : new Unread(`${shorten(node.getText())} holds a value known only once deployed`, 'token');
      }
      text += String(part) + span.getLiteral().getLiteralText();
    }
    return text;
  }

  #object(node: TsNode & { getProperties(): TsNode[] }, scope: Scope, frame: Frame): ObjectValue {
    const out = new ObjectValue();
    for (const property of node.getProperties()) {
      if (Node.isPropertyAssignment(property)) {
        const nameNode = property.getNameNode();
        const name = Node.isComputedPropertyName(nameNode) ? textOf(this.value(nameNode.getExpression(), scope, frame)) : nameNode.getText().replace(/^['"`]|['"`]$/g, '');
        const initializer = property.getInitializer();
        if (name !== undefined && initializer !== undefined) out.entries.set(name, this.value(initializer, scope, frame));
      } else if (Node.isShorthandPropertyAssignment(property)) {
        out.entries.set(property.getName(), this.value(property.getNameNode(), scope, frame));
      } else if (Node.isSpreadAssignment(property)) {
        const spread = this.value(property.getExpression(), scope, frame);
        if (spread instanceof ObjectValue) for (const [key, item] of spread.entries) out.entries.set(key, item);
      } else if (Node.isMethodDeclaration(property)) {
        out.entries.set(property.getName(), new FunctionValue(property, scope));
      }
    }
    return out;
  }

  #binary(node: TsNode & { getLeft(): TsNode; getRight(): TsNode; getOperatorToken(): TsNode }, scope: Scope, frame: Frame): Value {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.EqualsToken) {
      const value = this.value(node.getRight(), scope, frame);
      const left = node.getLeft();
      if (Node.isIdentifier(left)) scope.assign(left.getText(), value);
      else if (Node.isPropertyAccessExpression(left)) {
        const owner = this.value(left.getExpression(), scope, frame);
        if (owner instanceof Construct) owner.fields.set(left.getName(), value);
        else if (owner instanceof ObjectValue) owner.entries.set(left.getName(), value);
      }
      return value;
    }
    const left = this.value(node.getLeft(), scope, frame);
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
      // An environment variable nothing in the files sets falls back: the
      // fallback is what the files say, as an option with a default is.
      if (left instanceof Unread && left.environment !== undefined) return this.value(node.getRight(), scope, frame);
      const settled = operator === SyntaxKind.QuestionQuestionToken ? (left instanceof Unread ? undefined : left !== undefined && left !== null) : truthy(left);
      if (settled === undefined) return left;
      return settled ? left : this.value(node.getRight(), scope, frame);
    }
    if (operator === SyntaxKind.AmpersandAmpersandToken) {
      const settled = truthy(left);
      if (settled === undefined) return new Unread(`${shorten(node.getText())} is not settled`, 'condition');
      return settled ? this.value(node.getRight(), scope, frame) : left;
    }
    const right = this.value(node.getRight(), scope, frame);
    const plain = (value: Value): value is string | number | boolean | null | undefined =>
      value === null || value === undefined || typeof value !== 'object';
    if (!plain(left) || !plain(right)) return new Unread(`${shorten(node.getText())} holds a value the files do not settle`, 'operator');
    switch (operator) {
      case SyntaxKind.PlusToken:
        return typeof left === 'number' && typeof right === 'number' ? left + right : `${String(left)}${String(right)}`;
      case SyntaxKind.EqualsEqualsEqualsToken:
      case SyntaxKind.EqualsEqualsToken:
        return left === right;
      case SyntaxKind.ExclamationEqualsEqualsToken:
      case SyntaxKind.ExclamationEqualsToken:
        return left !== right;
      default:
        return new Unread(`${shorten(node.getText())} is not read`, 'operator');
    }
  }

  // ---------------------------------------------------------------- names

  #name(node: TsNode, scope: Scope, frame: Frame): Value {
    const text = node.getText();
    if (text === 'undefined') return undefined;
    if (scope.has(text)) return scope.get(text);
    if (text === '__dirname') return dirname(node.getSourceFile().getFilePath());
    if (text === '__filename') return node.getSourceFile().getFilePath();
    const symbol = node.getSymbol();
    const declaration = symbol?.getDeclarations()[0];
    if (declaration === undefined) return new Unread(`${text} is not declared in what was read`, 'unresolved-name');
    const imported = this.#imported(declaration);
    if (imported !== undefined) return imported;
    const aliased = symbol?.getAliasedSymbol()?.getDeclarations()[0];
    return this.#declared(aliased ?? declaration, text, frame);
  }

  /** What an import names, when it is the CDK's, the path module, or nothing this program holds. */
  #imported(declaration: TsNode): Value | undefined {
    const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (importDeclaration === undefined) return undefined;
    const specifier = importDeclaration.getModuleSpecifierValue();
    const module = cdkModuleOf(specifier);
    const path = isPathModule(specifier);
    if (module === undefined && !path) return undefined;
    const root = new CdkRef(path ? 'path' : (module as string), []);
    if (Node.isImportSpecifier(declaration)) return root.member(declaration.getName());
    return root;
  }

  /** A declaration of a module, read once: a constant, a function, a class. */
  #declared(declaration: TsNode, text: string, frame: Frame): Value {
    if (Node.isFunctionDeclaration(declaration)) return new FunctionValue(declaration, new Scope());
    if (Node.isClassDeclaration(declaration)) return new ClassValue(declaration);
    if (Node.isEnumMember(declaration)) return declaration.getValue() ?? new Unread(`${text} has no value written`, 'enum');
    if (Node.isParameterDeclaration(declaration)) return new Unread(`${text} is a parameter nothing that was read passes`, 'parameter');
    if (Node.isVariableDeclaration(declaration)) {
      if (this.#modules.has(declaration)) return this.#modules.get(declaration);
      const initializer = declaration.getInitializer();
      if (initializer === undefined) return new Unread(`${text} is declared with no value`, 'no-value');
      // Taken once: a module's constants are its own whoever imports them.
      this.#modules.set(declaration, new Unread(`${text} refers to itself`, 'cycle'));
      const value = this.value(initializer, new Scope(), {});
      this.#modules.set(declaration, value);
      return value;
    }
    const literal = evaluateExpression(declaration);
    return literal.resolved ? (literal.value as Value) : new Unread(`${text} is not a value this reads`, 'not-read');
  }

  /** `a.b`: a member of an object, a construct's attribute, a member of what the CDK exports. */
  #property(node: TsNode & { getExpression(): TsNode; getName(): string }, scope: Scope, frame: Frame): Value {
    const ownerNode = node.getExpression();
    if (ownerNode.getText() === 'process.env') {
      return new Unread(`the environment variable ${node.getName()} is read when the app is run`, 'environment', node.getName());
    }
    return this.member(this.value(ownerNode, scope, frame), node.getName(), node);
  }

  member(owner: Value, name: string, at: TsNode): Value {
    if (owner instanceof CdkRef) return staticValue(owner.member(name));
    if (owner instanceof ObjectValue) return owner.get(name);
    if (Array.isArray(owner)) return name === 'length' ? owner.length : new Unread(`${name} of a list is not read`, 'not-read');
    if (typeof owner === 'string') return name === 'length' ? owner.length : new Unread(`${name} of text is not read`, 'not-read');
    if (owner instanceof Construct) {
      if (name === 'node') return new NodeHandle(owner);
      // A parameter of the account looked up by its name: its value is the parameter (P253).
      if (PARAMETERS.has(owner.type) && owner.imported?.name !== undefined && (name === 'stringValue' || name === 'stringListValue')) return importedParameter(owner.imported.name);
      if (owner.fields.has(name)) return owner.fields.get(name);
      const child = constructProperty(owner, name, this.site(at));
      if (child !== undefined) {
        if (child instanceof Construct && !this.constructs.includes(child)) this.constructs.push(child);
        return child;
      }
      return new Attribute(owner, name);
    }
    if (owner instanceof Built && isChainable(owner) && name === 'endStates') return owner;
    if (owner instanceof Unread) return owner;
    if (owner === undefined || owner === null) return new Unread(`${name} of nothing`, 'not-set');
    return new Unread(`${name} is not read here`, 'not-read');
  }

  // ---------------------------------------------------------------- calls

  #args(node: TsNode & { getArguments(): TsNode[] }, scope: Scope, frame: Frame): Value[] {
    const out: Value[] = [];
    for (const argument of node.getArguments()) {
      if (Node.isSpreadElement(argument)) {
        const spread = this.value(argument.getExpression(), scope, frame);
        if (Array.isArray(spread)) out.push(...spread);
        else out.push(spread);
      } else out.push(this.value(argument, scope, frame));
    }
    return out;
  }

  #call(node: TsNode & { getExpression(): TsNode; getArguments(): TsNode[] }, scope: Scope, frame: Frame): Value {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee)) {
      const name = callee.getName();
      const receiverNode = callee.getExpression();
      const global = receiverNode.getText();
      if (global === 'JSON' && name === 'stringify') {
        const [value] = this.#args(node, scope, frame);
        const json = toJson(value as Value);
        return json === undefined ? new Built('json', [value as Value], this.site(node)) : JSON.stringify(json);
      }
      if (global === 'Object' && (name === 'keys' || name === 'values' || name === 'entries')) {
        const [value] = this.#args(node, scope, frame);
        if (!(value instanceof ObjectValue)) return new Unread(`${shorten(node.getText())} is not read`, 'not-an-object');
        const entries = [...value.entries];
        return name === 'keys' ? entries.map(([key]) => key) : name === 'values' ? entries.map(([, item]) => item) : entries.map(([key, item]) => [key, item]);
      }
      if (callee.getText() === 'super.constructor') return undefined;
      const receiver = this.value(receiverNode, scope, frame);
      const args = this.#args(node, scope, frame);
      return this.#method(receiver, name, args, node, frame);
    }
    if (callee.getKind() === SyntaxKind.SuperKeyword) {
      this.#super(this.#args(node, scope, frame), node, frame);
      return undefined;
    }
    const target = this.value(callee, scope, frame);
    const args = this.#args(node, scope, frame);
    if (target instanceof FunctionValue) return this.callFunction(target, args, frame.self, frame, node);
    if (target instanceof CdkRef && target.module === 'path') return pathCall(target.path[target.path.length - 1], args);
    return target instanceof Unread ? target : new Unread(`${shorten(node.getText())} is not a function this reads`, 'not-read');
  }

  #method(receiver: Value, name: string, args: Value[], node: TsNode, frame: Frame): Value {
    const site = this.#placed(node, frame);
    if (receiver instanceof CdkRef) {
      if (receiver.module === 'path') return pathCall(name, args);
      const imported = importedConstruct(receiver, name, args, site, frame, this.constructs);
      if (imported !== undefined) return imported;
      return staticCall(receiver.member(name), args, site);
    }
    if (receiver instanceof NodeHandle) {
      if (name === 'tryGetContext' && typeof args[0] === 'string') return (this.app.context[args[0]] as Value) ?? undefined;
      return undefined;
    }
    if (receiver instanceof Construct) {
      if (receiver.type.startsWith('app:')) {
        const method = this.#methodOf(receiver, name);
        if (method !== undefined) return this.callFunction(method, args, receiver, frame, node);
        if (name === 'exportValue') return this.#exportValue(receiver, args, site, frame);
        const field = receiver.fields.get(name);
        if (field instanceof FunctionValue) return this.callFunction(field, args, receiver, frame, node);
        return new Unread(`${name} of ${receiver.path} is not read`, 'not-read');
      }
      receiver.add(name, args, site, frame.conditional);
      if (isChainable(receiver)) return chainMethod(receiver, name, args, site);
      const made = constructMethod(receiver, name, args, site, frame);
      if (made instanceof Construct && !this.constructs.includes(made)) this.constructs.push(made);
      return made;
    }
    if (receiver instanceof Built) return isChainable(receiver) ? chainMethod(receiver, name, args, site) : new Unread(`${name} of ${receiver.what} is not read`, 'not-read');
    if (receiver instanceof FunctionValue && (name === 'call' || name === 'apply')) return this.callFunction(receiver, name === 'call' ? args.slice(1) : [], frame.self, frame, node);
    if (Array.isArray(receiver)) return this.#arrayMethod(receiver, name, args, frame, node);
    if (typeof receiver === 'string') return stringMethod(receiver, name, args);
    if (receiver instanceof Unread) return receiver;
    return new Unread(`${name} is not read here`, 'not-read');
  }

  #arrayMethod(items: Value[], name: string, args: Value[], frame: Frame, node: TsNode): Value {
    const [first] = args;
    if (items.length > MOST_ELEMENTS) return new Unread(`a list of ${items.length} elements is not walked`, 'too-long');
    if ((name === 'map' || name === 'forEach' || name === 'flatMap' || name === 'filter') && first instanceof FunctionValue) {
      const results = items.map((item, index) => this.callFunction(first, [item, index], frame.self, frame, node));
      if (name === 'forEach') return undefined;
      if (name === 'flatMap') return results.flatMap((result) => (Array.isArray(result) ? result : [result]));
      if (name === 'filter') return results.every((result) => truthy(result) !== undefined) ? items.filter((_item, index) => truthy(results[index] as Value) === true) : new Unread('a filter the files do not settle', 'condition');
      return results;
    }
    if (name === 'concat') return [...items, ...args.flatMap((arg) => (Array.isArray(arg) ? arg : [arg]))];
    if (name === 'join') return items.every((item) => typeof item === 'string' || typeof item === 'number') ? items.join(typeof first === 'string' ? first : ',') : new Unread('a list joined holds a value not read', 'not-text');
    if (name === 'includes') return items.includes(first);
    return new Unread(`${name} of a list is not read`, 'not-read');
  }

  #methodOf(construct: Construct, name: string): FunctionValue | undefined {
    let cls = this.#classOf(construct);
    for (let guard = 0; cls !== undefined && guard < 16; guard += 1) {
      const method = cls.getMethod(name);
      if (method !== undefined) return new FunctionValue(method, new Scope());
      cls = this.#baseClassOf(cls);
    }
    return undefined;
  }

  readonly #classes = new Map<Construct, ClassDeclaration | ClassExpression>();

  #classOf(construct: Construct): ClassDeclaration | ClassExpression | undefined {
    return this.#classes.get(construct);
  }

  /** The class of the app a class extends, when it extends one. */
  #baseClassOf(cls: ClassDeclaration | ClassExpression): ClassDeclaration | ClassExpression | undefined {
    const heritage = cls.getExtends();
    if (heritage === undefined) return undefined;
    const base = this.value(heritage.getExpression(), new Scope(), {});
    return base instanceof ClassValue ? base.node : undefined;
  }

  /** Whether a class of the app is a construct: it extends, at some remove, one of the CDK's construct bases. */
  isConstructClass(cls: ClassDeclaration | ClassExpression): boolean {
    let current: ClassDeclaration | ClassExpression | undefined = cls;
    for (let guard = 0; current !== undefined && guard < 16; guard += 1) {
      const heritage = current.getExtends();
      if (heritage === undefined) return false;
      const base = this.value(heritage.getExpression(), new Scope(), {});
      if (base instanceof CdkRef) return CONSTRUCT_BASES.has(base.key) || base.path.length > 0;
      current = base instanceof ClassValue ? base.node : undefined;
    }
    return false;
  }

  /** A function of the app called: its parameters bound, its body run, what it returns. */
  callFunction(fn: FunctionValue, args: readonly Value[], self: Construct | undefined, frame: Frame, at: TsNode): Value {
    if (this.#depth >= MOST_DEPTH) {
      this.#bound(at, 'calls nest deeper than the reading follows');
      return new Unread('the call is nested too deeply to follow', 'bound');
    }
    const node = fn.node;
    if (!(Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isMethodDeclaration(node) || Node.isConstructorDeclaration(node))) {
      return new Unread('the function is not one this reads', 'not-read');
    }
    const scope = new Scope(fn.scope);
    // A helper - a function or an arrow, not a method of a construct - places
    // what it makes at the call that asked for it.
    const helper = Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node);
    const { at: _outer, ...rest } = frame;
    const inner: Frame = { ...rest, ...(self === undefined ? {} : { self }), ...(helper ? { at: frame.at ?? this.site(at) } : {}) };
    node.getParameters().forEach((parameter, index) => {
      let value: Value = parameter.isRestParameter() ? args.slice(index) : args[index];
      const fallback = parameter.getInitializer();
      if (value === undefined && fallback !== undefined) value = this.value(fallback, scope, inner);
      this.#bind(parameter.getNameNode(), value, scope, inner);
      // A parameter property is a field of the construct too.
      if (Node.isConstructorDeclaration(node) && parameter.getScope() !== undefined && self !== undefined) self.fields.set(parameter.getName(), value);
    });
    this.#depth += 1;
    try {
      const body = node.getBody();
      if (body === undefined) return undefined;
      if (Node.isBlock(body)) return this.#block(body.getStatements(), scope, inner).value;
      return this.value(body, scope, inner);
    } finally {
      this.#depth -= 1;
    }
  }

  /**
   * `stack.exportValue(value, { name })`: the stack exports the value under
   * the name, as the CDK does itself for a value one of its stacks hands
   * another (P253). What it gives back is the import of it, which in this app
   * is the value itself; the export is a construct of its own, which the
   * reading of the deployment publishes.
   */
  #exportValue(stack: Construct, args: readonly Value[], site: Site, frame: Frame): Value {
    const [value, options] = args;
    const name = options instanceof ObjectValue ? options.get('name') : undefined;
    const props = new ObjectValue([
      ['value', value],
      ['exportName', name],
    ]);
    this.constructs.push(new Construct(EXPORT_VALUE, `${stack.path}/${typeof name === 'string' ? `Export${name}` : `Export@${site.line}`}`, site, props, [stack, 'Export', props], frame.conditional, frame.repeated));
    return value;
  }

  // ----------------------------------------------------------- construction

  #new(node: TsNode & { getExpression(): TsNode; getArguments(): TsNode[] }, scope: Scope, frame: Frame): Value {
    const target = this.value(node.getExpression(), scope, frame);
    const args = this.#args(node, scope, frame);
    const site = this.#placed(node, frame);
    if (target instanceof CdkRef) {
      if (target.key === 'core.App') {
        const app = new Construct('core.App', '', site, args[0] instanceof ObjectValue ? args[0] : undefined, args, frame.conditional, frame.repeated);
        this.constructs.push(app);
        return app;
      }
      if (isConstructCall(args)) {
        const construct = new Construct(target.key, pathOf(args, site), site, args[2] instanceof ObjectValue ? args[2] : undefined, args, frame.conditional, frame.repeated);
        this.constructs.push(construct);
        return construct;
      }
      return new Built(target.key, args, site);
    }
    if (target instanceof ClassValue) return this.#instantiate(target, args, node, frame);
    return target instanceof Unread ? target : new Unread(`${shorten(node.getText())} makes nothing this reads`, 'not-read');
  }

  #instantiate(target: ClassValue, args: readonly Value[], at: TsNode, frame: Frame): Value {
    const cls = target.node;
    this.instantiated.add(cls);
    const name = cls.getName() ?? 'Construct';
    const isConstruct = this.isConstructClass(cls);
    const path = isConstruct && isConstructCall(args) ? pathOf(args, this.site(at)) : `${name}@${this.site(at).file}:${this.site(at).line}`;
    const self = new Construct(`app:${name}`, path, this.site(at), args[2] instanceof ObjectValue ? args[2] : undefined, args, frame.conditional, frame.repeated);
    this.#classes.set(self, cls);
    this.constructs.push(self);
    this.#construct(cls, self, args, at, frame);
    return self;
  }

  /** Runs a class's field initializers and its constructor, with `this` the construct being built. */
  #construct(cls: ClassDeclaration | ClassExpression, self: Construct, args: readonly Value[], at: TsNode, frame: Frame): void {
    const inner: Frame = { ...frame, self, cls };
    const constructor = cls.getConstructors()[0];
    if (constructor === undefined) {
      // No constructor of its own: its base's runs with what it was handed.
      const base = this.#baseClassOf(cls);
      if (base !== undefined) this.#construct(base, self, args, at, frame);
      this.#fields(cls, self, inner);
      return;
    }
    // Field initializers run once the base constructor has, which in a class
    // that calls `super` is at that call: they are run there (`#super`).
    if (cls.getExtends() === undefined) this.#fields(cls, self, inner);
    this.callFunction(new FunctionValue(constructor, new Scope()), args, self, inner, at);
  }

  #fields(cls: ClassDeclaration | ClassExpression, self: Construct, frame: Frame): void {
    for (const property of cls.getProperties()) {
      if (property.isStatic()) continue;
      const initializer = property.getInitializer();
      if (initializer !== undefined) self.fields.set(property.getName(), this.value(initializer, new Scope(), frame));
    }
  }

  #super(args: readonly Value[], at: TsNode, frame: Frame): void {
    const cls = frame.cls;
    const self = frame.self;
    if (cls === undefined || self === undefined) return;
    const base = this.#baseClassOf(cls);
    if (base !== undefined) this.#construct(base, self, args, at, { ...frame, cls: base });
    this.#fields(cls, self, frame);
  }
}

/** The parameters of the account a value is read from by name. */
const PARAMETERS = new Set(['aws-ssm.StringParameter', 'aws-ssm.StringListParameter']);

/** Whether a `new` is a construct's: handed a scope and an id, as every construct is. */
const isConstructCall = (args: readonly Value[]): boolean =>
  (args[0] instanceof Construct || args[0] instanceof Unread) && (typeof args[1] === 'string' || args[1] instanceof Unread);

/** A construct's path: its scope's, then its id; where the id is not read, where it is made. */
const pathOf = (args: readonly Value[], site: Site): string => {
  const scope = args[0] instanceof Construct ? args[0].path : '?';
  const id = typeof args[1] === 'string' ? args[1] : `${site.file}:${site.line}`;
  return scope === '' ? id : `${scope}/${id}`;
};

/** `path.join`, `path.resolve`, `path.dirname`, `path.basename`, over text. */
const pathCall = (name: string | undefined, args: readonly Value[]): Value => {
  if (!args.every((arg) => typeof arg === 'string')) return new Unread('a path built from a value not read', 'not-text');
  const parts = args as string[];
  switch (name) {
    case 'join':
      return posix.join(...parts.map(toPosixPath));
    case 'resolve':
      return toPosixPath(resolvePath(...parts));
    case 'dirname':
      return posix.dirname(toPosixPath(parts[0] ?? ''));
    case 'basename':
      return posix.basename(toPosixPath(parts[0] ?? ''), parts[1]);
    default:
      return new Unread(`path.${name ?? '?'} is not read`, 'not-read');
  }
};

/** The text methods a name is built with. */
const stringMethod = (text: string, name: string, args: readonly Value[]): Value => {
  const [first, second] = args;
  switch (name) {
    case 'toLowerCase':
      return text.toLowerCase();
    case 'toUpperCase':
      return text.toUpperCase();
    case 'trim':
      return text.trim();
    case 'concat':
      return args.every((arg) => typeof arg === 'string') ? text.concat(...(args as string[])) : new Unread('text joined to a value not read', 'not-text');
    case 'replace':
    case 'replaceAll':
      return typeof first === 'string' && typeof second === 'string' ? (name === 'replace' ? text.replace(first, second) : text.replaceAll(first, second)) : new Unread('a replacement not read', 'not-text');
    case 'split':
      return typeof first === 'string' ? text.split(first) : new Unread('a split not read', 'not-text');
    case 'startsWith':
      return typeof first === 'string' ? text.startsWith(first) : new Unread('a test not read', 'not-text');
    case 'endsWith':
      return typeof first === 'string' ? text.endsWith(first) : new Unread('a test not read', 'not-text');
    case 'includes':
      return typeof first === 'string' ? text.includes(first) : new Unread('a test not read', 'not-text');
    case 'slice':
    case 'substring':
      return typeof first === 'number' ? text.slice(first, typeof second === 'number' ? second : undefined) : new Unread('a slice not read', 'not-text');
    default:
      return new Unread(`${name} of text is not read`, 'not-read');
  }
};

/**
 * `Function.fromFunctionName(this, 'Id', 'name')` and its kind: a construct the
 * app does not create and names, which a target or a value can point at.
 */
const importedConstruct = (ref: CdkRef, method: string, args: readonly Value[], site: Site, frame: Frame, constructs: Construct[]): Construct | undefined => {
  if (!/^from[A-Z]/.test(method) || !isConstructCall(args)) return undefined;
  const written = args[2];
  const attributes = written instanceof ObjectValue ? written : undefined;
  const text =
    textOf(written as Value) ??
    textOf(attributes?.get('functionArn')) ??
    textOf(attributes?.get('queueArn')) ??
    textOf(attributes?.get('topicArn')) ??
    textOf(attributes?.get('tableName')) ??
    textOf(attributes?.get('parameterName'));
  const isArn = /Arn$/.test(method) || (text?.startsWith('arn:') ?? false);
  const imported =
    text === undefined
      ? { unread: written instanceof Unread ? written : new Unread(`what ${ref.key}.${method} looks up is not read`, 'not-text') }
      : isArn
        ? { arn: text }
        : { name: text };
  const construct = new Construct(ref.key, pathOf(args, site), site, attributes, args, frame.conditional, frame.repeated, imported);
  constructs.push(construct);
  return construct;
};

