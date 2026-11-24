import {
  ASTWithSource,
  Binary,
  BindingPipe,
  Call,
  Chain,
  Conditional,
  ImplicitReceiver,
  Interpolation,
  KeyedRead,
  KeyedWrite,
  LiteralArray,
  LiteralMap,
  LiteralPrimitive,
  NonNullAssert,
  parseTemplate,
  PrefixNot,
  PropertyRead,
  PropertyWrite,
  SafeCall,
  SafeKeyedRead,
  SafePropertyRead,
  TemplateLiteral,
  ThisReceiver,
  TmplAstBoundAttribute,
  TmplAstBoundEvent,
  TmplAstBoundText,
  TmplAstElement,
  TmplAstForLoopBlock,
  TmplAstIfBlock,
  TmplAstLetDeclaration,
  TmplAstSwitchBlock,
  TmplAstTemplate,
  TypeofExpression,
  Unary,
  type AST,
  type TmplAstNode,
} from '@angular/compiler';

/**
 * What a component's template does with each of the component's members
 * (P391): the fields it reads off a member's value, where a client's answer
 * held there is read on screen.
 *
 * A read is a chain from the member, `order.customer.name`, past what changes
 * nothing about the value: the async pipe (`(order$ | async)?.total`), a
 * signal's call (`order().total`), a non-null mark, an element of a list
 * (`order.lines[0]`). A name the template binds stands for what it is bound
 * to: an element of `@for (line of order.lines)` or `*ngFor` is the list's
 * path, `@if (order$ | async; as order)`, `*ngIf="… as order"` and
 * `@let total = order.total` the expression's. The value handed to a method
 * of the component (`(click)="open(order)"`) or bound to an input of an
 * element (`[order]="o"`) is said as that, for the reader to follow; one
 * written to another member (`selected = order`) is bound to that member. A
 * pipe other than async is handed the value and reads what it reads; a key
 * held as code reads what the reading cannot name: both are said.
 */

/** A value read from a member: the member and the path under it. */
interface Resolved {
  readonly member: string;
  readonly path: readonly string[];
}

export interface TemplateMemberRows {
  reads: Array<{ member: string; path: string[]; line: number }>;
  /** The value handed to a method of the component, at an argument. */
  handed: Array<{ member: string; path: string[]; method: string; index: number; line: number }>;
  /** The value bound to a property of an element (a child component's input, it may be), or written to a member. */
  bound: Array<{ member: string; path: string[]; element: string | null; property: string; line: number }>;
  unread: Array<{ member: string; line: number; why: string }>;
}

/** Names the template binds, each to what it stands for, or null for one that stands for no member. */
type Scope = ReadonlyMap<string, Resolved | null>;

const unwrap = (ast: AST): AST => {
  let node = ast instanceof ASTWithSource ? ast.ast : ast;
  while (node instanceof NonNullAssert) node = node.expression;
  return node;
};

/** `length` read off a list is how many, not a field. */
const fieldPath = (path: readonly string[]): string[] => (path.at(-1) === 'length' ? path.slice(0, -1) : [...path]);

/** What an expression is a read of, where it is a chain from a member or from a name bound to one. */
const resolve = (ast: AST, scope: Scope): Resolved | undefined => {
  const node = unwrap(ast);
  if (node instanceof PropertyRead || node instanceof SafePropertyRead) {
    if (node.receiver instanceof ImplicitReceiver) {
      if (!(node.receiver instanceof ThisReceiver) && scope.has(node.name)) return scope.get(node.name) ?? undefined;
      return { member: node.name, path: [] };
    }
    const inner = resolve(node.receiver, scope);
    return inner === undefined ? undefined : { member: inner.member, path: [...inner.path, node.name] };
  }
  if (node instanceof KeyedRead || node instanceof SafeKeyedRead) {
    const key = unwrap(node.key);
    if (!(key instanceof LiteralPrimitive)) return undefined;
    const inner = resolve(node.receiver, scope);
    if (inner === undefined) return undefined;
    return typeof key.value === 'string' ? { member: inner.member, path: [...inner.path, key.value] } : inner;
  }
  // A signal read, `order()`: its value. A method called on a field is not.
  if ((node instanceof Call || node instanceof SafeCall) && node.args.length === 0) {
    const inner = resolve(node.receiver, scope);
    return inner !== undefined && inner.path.length === 0 ? inner : undefined;
  }
  if (node instanceof BindingPipe && node.name === 'async') return resolve(node.exp, scope);
  return undefined;
};

/** Whether an expression is one of the shapes `resolve` reads as a chain. */
const isChain = (node: AST): boolean =>
  node instanceof PropertyRead ||
  node instanceof SafePropertyRead ||
  node instanceof KeyedRead ||
  node instanceof SafeKeyedRead ||
  node instanceof Call ||
  node instanceof SafeCall ||
  node instanceof BindingPipe;

/** Reads every expression of a template against its component's members. */
class MemberScan {
  readonly rows: TemplateMemberRows = { reads: [], handed: [], bound: [], unread: [] };

  constructor(private readonly startLine: number) {}

  #read(found: Resolved, line: number): void {
    const path = fieldPath(found.path);
    if (path.length > 0) this.rows.reads.push({ member: found.member, path, line });
  }

  /** One expression, at a line, under the names in scope. */
  expression(ast: AST | null | undefined, scope: Scope, line: number): void {
    if (ast === null || ast === undefined) return;
    const node = unwrap(ast);
    if (isChain(node)) {
      this.#chain(node, scope, line);
      return;
    }
    if (node instanceof PropertyWrite) {
      // `selected = order`: the value is the other member's now.
      const found = resolve(node.value, scope);
      if (found !== undefined && node.receiver instanceof ImplicitReceiver && !scope.has(node.name)) {
        this.rows.bound.push({ member: found.member, path: [...found.path], element: null, property: node.name, line });
        return;
      }
      this.expression(node.receiver, scope, line);
      this.expression(node.value, scope, line);
      return;
    }
    if (node instanceof KeyedWrite) {
      this.expression(node.receiver, scope, line);
      this.expression(node.key, scope, line);
      this.expression(node.value, scope, line);
      return;
    }
    if (node instanceof Unary) {
      this.expression(node.expr, scope, line);
      return;
    }
    if (node instanceof Binary) {
      this.expression(node.left, scope, line);
      this.expression(node.right, scope, line);
      return;
    }
    if (node instanceof Conditional) {
      this.expression(node.condition, scope, line);
      this.expression(node.trueExp, scope, line);
      this.expression(node.falseExp, scope, line);
      return;
    }
    if (node instanceof PrefixNot || node instanceof TypeofExpression) {
      this.expression(node.expression, scope, line);
      return;
    }
    if (node instanceof Interpolation || node instanceof TemplateLiteral || node instanceof LiteralArray || node instanceof Chain) {
      for (const each of node.expressions as AST[]) this.expression(each, scope, line);
      return;
    }
    if (node instanceof LiteralMap) for (const each of node.values as AST[]) this.expression(each, scope, line);
  }

  /** A chain: read where it resolves, and what is handed in along it read too. */
  #chain(node: AST, scope: Scope, line: number): void {
    const found = resolve(node, scope);
    if (found !== undefined) {
      this.#read(found, line);
      return;
    }
    if (node instanceof Call || node instanceof SafeCall) {
      const callee = unwrap(node.receiver);
      // `open(order)`: a method of the component is handed the value.
      if ((callee instanceof PropertyRead || callee instanceof SafePropertyRead) && callee.receiver instanceof ImplicitReceiver && !(scope.has(callee.name) && !(callee.receiver instanceof ThisReceiver))) {
        node.args.forEach((argument, index) => {
          const handed = resolve(argument, scope);
          if (handed !== undefined) this.rows.handed.push({ member: handed.member, path: [...handed.path], method: callee.name, index, line });
          else this.expression(argument, scope, line);
        });
        return;
      }
      // `order.lines.includes(x)`: what the method is called on is read.
      if (callee instanceof PropertyRead || callee instanceof SafePropertyRead) {
        const on = resolve(callee.receiver, scope);
        if (on !== undefined) this.#read(on, line);
        else this.expression(callee.receiver, scope, line);
      } else this.expression(callee, scope, line);
      for (const argument of node.args) {
        const handed = resolve(argument, scope);
        if (handed !== undefined && fieldPath(handed.path).length === 0) {
          this.rows.unread.push({ member: handed.member, line, why: `handed to ${callee instanceof PropertyRead ? callee.name : 'a call'} in the template` });
        } else if (handed !== undefined) this.#read(handed, line);
        else this.expression(argument, scope, line);
      }
      return;
    }
    if (node instanceof KeyedRead || node instanceof SafeKeyedRead) {
      const on = resolve(node.receiver, scope);
      if (on !== undefined) {
        this.#read(on, line);
        this.rows.unread.push({ member: on.member, line, why: 'indexed by a key held as code in the template' });
      } else this.expression(node.receiver, scope, line);
      this.expression(node.key, scope, line);
      return;
    }
    if (node instanceof BindingPipe) {
      const piped = resolve(node.exp, scope);
      if (piped !== undefined && fieldPath(piped.path).length > 0) this.#read(piped, line);
      else if (piped !== undefined) this.rows.unread.push({ member: piped.member, line, why: `handed to the ${node.name} pipe` });
      else this.expression(node.exp, scope, line);
      for (const argument of node.args as AST[]) this.expression(argument, scope, line);
      return;
    }
    if (node instanceof PropertyRead || node instanceof SafePropertyRead) this.expression(node.receiver, scope, line);
  }

  #line(span: { start: { line: number } }): number {
    return span.start.line + this.startLine;
  }

  /** A property bound on an element: read, and bound to the element's property for the reader to follow. */
  #input(input: TmplAstBoundAttribute, element: string | null, scope: Scope): void {
    const line = this.#line(input.sourceSpan);
    const found = resolve(input.value, scope);
    if (found === undefined) {
      this.expression(input.value, scope, line);
      return;
    }
    this.#read(found, line);
    this.rows.bound.push({ member: found.member, path: [...found.path], element, property: input.name, line });
  }

  /** Every node under one view; a `@let` binds a name for the nodes after it. */
  nodes(nodes: readonly TmplAstNode[], outer: Scope): void {
    const scope = new Map(outer);
    for (const node of nodes) {
      if (node instanceof TmplAstLetDeclaration) {
        this.expression(node.value, scope, this.#line(node.sourceSpan));
        scope.set(node.name, resolve(node.value, scope) ?? null);
        continue;
      }
      this.node(node, scope);
    }
  }

  node(node: TmplAstNode, scope: Scope): void {
    if (node instanceof TmplAstBoundText) {
      this.expression(node.value, scope, this.#line(node.sourceSpan));
      return;
    }
    if (node instanceof TmplAstElement) {
      for (const input of node.inputs) this.#input(input, node.name, scope);
      for (const output of node.outputs) this.#event(output, scope);
      const inner = new Map(scope);
      for (const reference of node.references) inner.set(reference.name, null);
      this.nodes(node.children, inner);
      return;
    }
    if (node instanceof TmplAstTemplate) {
      const inner = new Map(scope);
      const attribute = (name: string): TmplAstBoundAttribute | undefined =>
        node.templateAttrs.find((each): each is TmplAstBoundAttribute => each instanceof TmplAstBoundAttribute && each.name === name);
      for (const each of node.templateAttrs) if (each instanceof TmplAstBoundAttribute) this.expression(each.value, scope, this.#line(each.sourceSpan));
      for (const variable of node.variables) {
        // `*ngFor="let line of lines"`: the element; `*ngIf="x as y"`: the value tested.
        const list = variable.value === '$implicit' ? attribute('ngForOf') : undefined;
        const tested = variable.value === 'ngIf' ? attribute('ngIf') : undefined;
        const from = list ?? tested;
        inner.set(variable.name, from === undefined ? null : (resolve(from.value, scope) ?? null));
      }
      for (const reference of node.references) inner.set(reference.name, null);
      // On an element, `*ngFor` lifts the element's bindings onto the template too: they are read on the element.
      if (node.tagName === 'ng-template') {
        for (const input of node.inputs) this.#input(input, null, inner);
        for (const output of node.outputs) this.#event(output, inner);
      }
      this.nodes(node.children, inner);
      return;
    }
    if (node instanceof TmplAstIfBlock) {
      for (const branch of node.branches) {
        this.expression(branch.expression, scope, this.#line(branch.sourceSpan));
        const inner = new Map(scope);
        if (branch.expressionAlias !== null && branch.expression !== null) inner.set(branch.expressionAlias.name, resolve(branch.expression, scope) ?? null);
        this.nodes(branch.children, inner);
      }
      return;
    }
    if (node instanceof TmplAstForLoopBlock) {
      const line = this.#line(node.sourceSpan);
      const list = resolve(node.expression, scope);
      if (list !== undefined) this.#read(list, line);
      else this.expression(node.expression, scope, line);
      const inner = new Map(scope);
      inner.set(node.item.name, list ?? null);
      for (const variable of node.contextVariables) inner.set(variable.name, null);
      this.expression(node.trackBy, inner, line);
      this.nodes(node.children, inner);
      if (node.empty !== null) this.nodes(node.empty.children, scope);
      return;
    }
    if (node instanceof TmplAstSwitchBlock) {
      this.expression(node.expression, scope, this.#line(node.sourceSpan));
      for (const each of node.cases) {
        this.expression(each.expression, scope, this.#line(each.sourceSpan));
        this.nodes(each.children, scope);
      }
      return;
    }
    // A deferred block, its placeholder, loading and error parts, projected content: their children.
    const holder = node as unknown as { children?: TmplAstNode[]; placeholder?: { children: TmplAstNode[] } | null; loading?: { children: TmplAstNode[] } | null; error?: { children: TmplAstNode[] } | null };
    if (Array.isArray(holder.children)) this.nodes(holder.children, scope);
    for (const part of [holder.placeholder, holder.loading, holder.error]) if (part !== undefined && part !== null) this.nodes(part.children, scope);
  }

  #event(output: TmplAstBoundEvent, scope: Scope): void {
    const inner = new Map(scope);
    inner.set('$event', null);
    this.expression(output.handler, inner, this.#line(output.sourceSpan));
  }
}

/** What a template does with each member of its component, from one parse; lines offset into the file it lives in. */
export const readTemplateMembers = (source: string, file: string, startLine = 1): TemplateMemberRows => {
  const parsed = parseTemplate(source, file, { preserveWhitespaces: false });
  const scan = new MemberScan(startLine);
  scan.nodes(parsed.nodes, new Map());
  return scan.rows;
};
