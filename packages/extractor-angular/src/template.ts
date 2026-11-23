import {
  ASTWithSource,
  Binary,
  Call,
  Chain,
  ImplicitReceiver,
  Interpolation,
  KeyedRead,
  LiteralArray,
  LiteralPrimitive,
  NonNullAssert,
  parseTemplate,
  PropertyRead,
  SafeCall,
  SafeKeyedRead,
  SafePropertyRead,
  ThisReceiver,
  createCssSelectorFromNode,
  type CssSelector,
  TmplAstBoundAttribute,
  type TmplAstElement,
  TmplAstRecursiveVisitor,
  tmplAstVisitAll,
  type AST,
  type TmplAstBoundEvent,
  type TmplAstForLoopBlock,
  type TmplAstLetDeclaration,
  type TmplAstNode,
  type TmplAstReference,
  type TmplAstTemplate,
  type TmplAstTextAttribute,
  type TmplAstVariable,
} from '@angular/compiler';

/**
 * The kinds of trigger the graph distinguishes.
 *
 * Anything a component template can bind that is not one of the first five is
 * still a trigger — a child component's own output, most often — and reaching
 * the handler behind it matters just as much, so it is kept as `custom` rather
 * than dropped.
 */
export type TemplateEventKind =
  | 'click'
  | 'submit'
  | 'change'
  | 'input'
  | 'keyup'
  | 'route'
  | 'custom';

/**
 * What the handler expression turned out to be.
 *
 * `local` is the one kind that names something the template itself bound - a
 * `let-` context field, a `#ref`, a `@for` item, an `@if` alias, an `@let`. It
 * is kept apart from `member` because the two look identical in the expression
 * and mean opposite things: a member is a property of the component, and a local
 * is a name the component never declared and never should (R105).
 */
export type TemplateHandler =
  | {
      readonly kind: 'method';
      readonly method: string;
      readonly args: string[];
      /** What each argument reads, where it is a read (`go(item)`, `open(item.slug)`), which the method's parameters stand for (P370). */
      readonly reads?: ReadonlyArray<TemplateRead | undefined>;
    }
  | {
      readonly kind: 'member';
      readonly property: string;
      readonly method: string;
      readonly args: string[];
      /** The address its first argument spells from what the template reads, where it reads something (P363). */
      readonly address?: TemplateAddress;
    }
  | {
      readonly kind: 'local';
      /** The name the template bound, which is the root of the call. */
      readonly local: string;
      readonly method: string;
      readonly args: string[];
    }
  | { readonly kind: 'other'; readonly text: string };

/** One step of a read: a member of what came before, or a call of it with nothing handed. */
export type TemplateStep = { readonly member: string } | { readonly call: true };

/**
 * A value a template reads, as the name it starts from and the steps after
 * it (P363): `item.route` is `item` then `route`, `items()` is `items` then
 * a call. `own` where the name is written `this.x`, which no local shadows.
 */
export interface TemplateRead {
  readonly root: string;
  readonly steps: readonly TemplateStep[];
  readonly text: string;
  readonly own?: true;
}

/** A piece of an address: text written as it is, or a value read. */
export type AddressPart = { readonly text: string } | { readonly read: TemplateRead };

/**
 * An address a link or a navigation spells from what the template reads
 * (P363): `item.route`, `'/x/' + item.slug`, `/x/{{ item.slug }}`, or the
 * segments of `['/x', item.slug]`, joined with `/`.
 */
export interface TemplateAddress {
  readonly parts: readonly AddressPart[];
  readonly segments: boolean;
}

/** What a loop variable in scope walks: the list it is read over, or why that was not read. */
export type LoopSource = TemplateRead | { readonly unread: string };

export interface TemplateEvent {
  /** Event as written, e.g. `click`, `ngSubmit`, `keyup.enter`. */
  name: string;
  kind: TemplateEventKind;
  /** The handler expression as written. */
  source: string;
  /** Every call the handler makes, in the order written. */
  handlers: TemplateHandler[];
  /** Route a link navigates to, for a `routerLink`. */
  route?: string | null;
  /** The address a link spells from what the template reads, where it reads something (P363). */
  address?: TemplateAddress;
  /** The loop variables in scope where it is written, each with the list it walks (P363). */
  loops?: ReadonlyMap<string, LoopSource>;
  /** 1-based, already offset into the file the template lives in. */
  line: number;
  column: number;
}

/**
 * An element a template writes (P370): the selector Angular matches the
 * declared components and directives against, its tag, and where it is.
 */
export interface TemplateElement {
  readonly selector: CssSelector;
  readonly name: string;
  /** 1-based, already offset into the file the template lives in. */
  readonly line: number;
}

/** Every element a template writes, an element inside `*ngIf`, `@if` or `<ng-template>` as much as any other. */
class ElementCollector extends TmplAstRecursiveVisitor {
  readonly elements: Array<{ selector: CssSelector; name: string; line: number }> = [];

  override visitElement(element: TmplAstElement): void {
    this.elements.push({ selector: createCssSelectorFromNode(element), name: element.name, line: element.sourceSpan.start.line });
    super.visitElement(element);
  }
}

export interface ParseTemplateOptions {
  /** 1-based line the template text starts at inside `file`. */
  startLine?: number;
  /** 1-based column the template text starts at, applied to its first line only. */
  startColumn?: number;
  /** What a hole in a link becomes when its value is only known at run time. */
  placeholder?: string;
  /**
   * Told about anything the compiler could not read.
   *
   * A template with a structural mistake in it usually yields no nodes at all,
   * so what is lost is every trigger in it. That is worth saying out loud rather
   * than letting a component look as though it has no buttons.
   */
  onError?(message: string, line: number): void;
}

/**
 * A `Map`, because the event name is whatever the template binds, and an object
 * literal answers `(constructor)` with the language's own function (R130).
 */
const KIND_BY_EVENT: ReadonlyMap<string, TemplateEventKind> = new Map([
  ['click', 'click'],
  ['submit', 'submit'],
  ['ngsubmit', 'submit'],
  ['change', 'change'],
  ['ngmodelchange', 'change'],
  ['input', 'input'],
]);

const DEFAULT_PLACEHOLDER = ':param';

/** The router's methods a handler navigates with, whose first argument is an address. */
const NAVIGATING = new Set(['navigate', 'navigateByUrl']);

const unwrapped = (ast: AST): AST => {
  let node = ast instanceof ASTWithSource ? ast.ast : ast;
  while (node instanceof NonNullAssert) node = node.expression;
  return node;
};

/** What a template reads, where an expression is a chain of members and calls with nothing handed from a name (P363). */
export const readOf = (ast: AST, source: string): TemplateRead | undefined => {
  const whole = unwrapped(ast);
  const text = source.slice(whole.span.start, whole.span.end) || String((ast as { source?: string }).source ?? '');
  const steps: TemplateStep[] = [];
  let node: AST = whole;
  for (let depth = 0; depth < 16; depth += 1) {
    if (node instanceof NonNullAssert) {
      node = node.expression;
      continue;
    }
    if (node instanceof Call || node instanceof SafeCall) {
      if (node.args.length > 0) return undefined;
      steps.unshift({ call: true });
      node = node.receiver;
      continue;
    }
    if (node instanceof PropertyRead || node instanceof SafePropertyRead) {
      if (node.receiver instanceof ImplicitReceiver) {
        return { root: node.name, steps, text, ...(node.receiver instanceof ThisReceiver ? { own: true as const } : {}) };
      }
      steps.unshift({ member: node.name });
      node = node.receiver;
      continue;
    }
    if ((node instanceof KeyedRead || node instanceof SafeKeyedRead) && node.key instanceof LiteralPrimitive && typeof node.key.value === 'string') {
      steps.unshift({ member: node.key.value });
      node = node.receiver;
      continue;
    }
    return undefined;
  }
  return undefined;
};

/** The pieces an address is written with, where each is text or a read; undefined for anything else. */
const partsOf = (ast: AST, source: string): AddressPart[] | undefined => {
  const node = unwrapped(ast);
  if (node instanceof LiteralPrimitive) return typeof node.value === 'string' ? [{ text: node.value }] : undefined;
  if (node instanceof Binary && node.operation === '+') {
    const left = partsOf(node.left, source);
    const right = partsOf(node.right, source);
    return left === undefined || right === undefined ? undefined : [...left, ...right];
  }
  if (node instanceof Interpolation) {
    const parts: AddressPart[] = [];
    for (let at = 0; at < node.strings.length; at += 1) {
      const text = node.strings[at] as string;
      if (text !== '') parts.push({ text });
      const expression = node.expressions[at];
      if (expression === undefined) continue;
      const inner = partsOf(expression, source);
      if (inner === undefined) return undefined;
      parts.push(...inner);
    }
    return parts;
  }
  const read = readOf(node, source);
  return read === undefined ? undefined : [{ read }];
};

/**
 * The address an expression spells from what the template reads (P363): one
 * piece or several joined, or the segments of an array. Undefined where it
 * reads nothing - an address written out is the route already - or holds a
 * piece neither text nor a read.
 */
export const addressOf = (ast: AST, source: string): TemplateAddress | undefined => {
  const node = unwrapped(ast);
  if (node instanceof LiteralArray) {
    const parts: AddressPart[] = [];
    for (const element of node.expressions as AST[]) {
      const inner = partsOf(element, source);
      if (inner === undefined || inner.length !== 1) return undefined;
      parts.push(inner[0] as AddressPart);
    }
    return parts.some((part) => 'read' in part) ? { parts, segments: true } : undefined;
  }
  const parts = partsOf(node, source);
  return parts === undefined || !parts.some((part) => 'read' in part) ? undefined : { parts, segments: false };
};

const kindOf = (name: string): TemplateEventKind => {
  const lowered = name.toLowerCase();
  if (lowered.startsWith('keyup') || lowered.startsWith('keydown')) return 'keyup';
  return KIND_BY_EVENT.get(lowered) ?? 'custom';
};

/**
 * Reads the calls out of a handler expression.
 *
 * The grammar accepted is exactly what a handler can be for the graph to reach a
 * method: a call, several calls in a row, or a call on a property of the
 * component. Everything else — an assignment, a conditional, a call on the event
 * object — is reported as written, because there is no method behind it to point
 * an edge at.
 */
const handlersOf = (handler: AST, locals: ReadonlySet<string>): TemplateHandler[] => {
  const root = handler instanceof ASTWithSource ? handler.ast : handler;
  const written = root instanceof Chain ? root.expressions : [root];
  const text = String((handler as { source?: string }).source ?? '');
  const argsOf = (call: Call | SafeCall): string[] =>
    call.args.map((argument) => text.slice(argument.span.start, argument.span.end));
  /** A component method's call with what each argument reads, where any reads something (P370). */
  const methodCall = (method: string, call: Call | SafeCall): TemplateHandler => {
    // `$event` is what the event carries at run time, which nothing here reads.
    const reads = call.args.map((argument) => {
      const read = readOf(argument, text);
      return read?.root === '$event' ? undefined : read;
    });
    return { kind: 'method', method, args: argsOf(call), ...(reads.some((read) => read !== undefined) ? { reads } : {}) };
  };

  return written.map((expression): TemplateHandler => {
    if (!(expression instanceof Call) && !(expression instanceof SafeCall)) {
      return { kind: 'other', text };
    }
    const callee = expression.receiver;
    if (!(callee instanceof PropertyRead) && !(callee instanceof SafePropertyRead)) {
      return { kind: 'other', text };
    }
    const receiver = callee.receiver;
    // `ThisReceiver` is `this.submit()`, the plain implicit one is `submit()`.
    // `this.` is the one spelling that cannot be a local: it is the component by
    // definition, so a name reached through it is never shadowed by a template.
    if (receiver instanceof ThisReceiver) {
      return methodCall(callee.name, expression);
    }
    if (receiver instanceof ImplicitReceiver) {
      return locals.has(callee.name)
        ? { kind: 'local', local: callee.name, method: callee.name, args: argsOf(expression) }
        : methodCall(callee.name, expression);
    }
    if (
      (receiver instanceof PropertyRead || receiver instanceof SafePropertyRead) &&
      receiver.receiver instanceof ImplicitReceiver
    ) {
      const [first] = expression.args;
      const address = NAVIGATING.has(callee.name) && first !== undefined ? addressOf(first, text) : undefined;
      return locals.has(receiver.name)
        ? {
            kind: 'local',
            local: receiver.name,
            method: callee.name,
            args: argsOf(expression),
          }
        : {
            kind: 'member',
            property: receiver.name,
            method: callee.name,
            args: argsOf(expression),
            ...(address === undefined ? {} : { address }),
          };
    }
    return { kind: 'other', text };
  });
};

/** The path a `[routerLink]="['/orders', id]"` navigates to, holes included. */
const routeOfExpression = (ast: AST, placeholder: string): string | null => {
  const root = ast instanceof ASTWithSource ? ast.ast : ast;
  const literal = root as { expressions?: AST[]; value?: unknown };
  if (typeof literal.value === 'string') return literal.value;
  // `routerLink="/orders/{{ id }}"`: the text between the holes is the address too (P363).
  if (root instanceof Interpolation) {
    const joined = root.strings.map((text, at) => (at < root.expressions.length ? `${text}${placeholder}` : text)).join('');
    return joined === '' ? null : joined;
  }
  if (!Array.isArray(literal.expressions)) return null;
  const parts = literal.expressions.map((element) => {
    const value = (element as { value?: unknown }).value;
    return typeof value === 'string' ? value : placeholder;
  });
  return parts.length === 0 ? null : parts.join('/').replace(/\/{2,}/g, '/');
};

/**
 * Every name the template itself binds.
 *
 * Collected with the compiler's own walk rather than by looking for `let-`
 * attributes: `let-hide="close"`, `#modal`, `@for (order of orders)`,
 * `@if (user(); as person)` and `@let total = …` are five spellings of one fact,
 * and each of them arrives here as the node kind the compiler already has a
 * visit method for, so a sixth spelling costs nothing to follow.
 *
 * One set for the whole template rather than a scope per node. A local is in
 * scope for the view that declares it, and an element's `#ref` is in scope for
 * the whole of that view including the lines above it, so answering "is this
 * name a local" needs the whole template read before the first binding is
 * judged. The cost is that a name bound in one `<ng-template>` is treated as a
 * local in the rest of the file too; the alternative was reporting a local as a
 * method the component forgot to declare, which on a video platform was every one of
 * the 35 rows that reason produced (R105).
 */
class LocalCollector extends TmplAstRecursiveVisitor {
  readonly names = new Set<string>();

  override visitVariable(variable: TmplAstVariable): void {
    this.names.add(variable.name);
  }

  override visitReference(reference: TmplAstReference): void {
    this.names.add(reference.name);
  }

  override visitLetDeclaration(declaration: TmplAstLetDeclaration): void {
    this.names.add(declaration.name);
    super.visitLetDeclaration(declaration);
  }
}

const localsOf = (nodes: TmplAstNode[]): ReadonlySet<string> => {
  const collector = new LocalCollector();
  tmplAstVisitAll(collector, nodes);
  return collector.names;
};

class EventCollector extends TmplAstRecursiveVisitor {
  readonly events: TemplateEvent[] = [];
  readonly #seen = new Set<string>();
  readonly #placeholder: string;
  readonly #locals: ReadonlySet<string>;
  /** The loop variables in scope, innermost last, each with the list it walks (P363). */
  readonly #loops: Array<readonly [string, LoopSource]> = [];

  constructor(placeholder: string, locals: ReadonlySet<string>) {
    super();
    this.#placeholder = placeholder;
    this.#locals = locals;
  }

  /** The list a loop is written over, as a read, or why it is not one. */
  static #sourceOf(ast: AST): LoopSource {
    const source = String((ast as { source?: string }).source ?? '');
    return readOf(ast, source) ?? { unread: `the list ${source.trim()} is not a member, a call of one with nothing handed, or a member of a loop's element` };
  }

  #within(name: string, source: LoopSource, visit: () => void): void {
    this.#loops.push([name, source]);
    try {
      visit();
    } finally {
      this.#loops.pop();
    }
  }

  /** The loops in scope, the innermost of one name winning, where there are any. */
  #scope(): { loops?: ReadonlyMap<string, LoopSource> } {
    return this.#loops.length === 0 ? {} : { loops: new Map(this.#loops) };
  }

  /** `@for (item of items(); track item.id)`: what is read inside reads `item` off `items()` (P363). */
  override visitForLoopBlock(block: TmplAstForLoopBlock): void {
    this.#within(block.item.name, EventCollector.#sourceOf(block.expression), () => super.visitForLoopBlock(block));
  }

  /** `*ngFor="let item of items"`: the template's `ngForOf` is the list, its `$implicit` variable the element (P363). */
  override visitTemplate(template: TmplAstTemplate): void {
    const over = template.templateAttrs.find((attribute): attribute is TmplAstBoundAttribute => attribute instanceof TmplAstBoundAttribute && attribute.name === 'ngForOf');
    const item = template.variables.find((variable) => variable.value === '$implicit');
    if (over === undefined || item === undefined) {
      super.visitTemplate(template);
      return;
    }
    this.#within(item.name, EventCollector.#sourceOf(over.value), () => super.visitTemplate(template));
  }

  /**
   * A structural directive lifts the element's bindings onto the template it
   * wraps, so the same binding is visited twice. Where it was written is what
   * identifies it, so seeing it again is not a second trigger.
   */
  #add(event: TemplateEvent): void {
    const key = `${event.line}:${event.column}:${event.name}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.events.push(event);
  }

  override visitBoundEvent(event: TmplAstBoundEvent): void {
    const handlers = handlersOf(event.handler, this.#locals);
    this.#add({
      name: event.name,
      kind: kindOf(event.name),
      source: String((event.handler as { source?: string }).source ?? ''),
      handlers,
      ...(handlers.some((handler) => (handler.kind === 'member' && handler.address !== undefined) || (handler.kind === 'method' && handler.reads !== undefined)) ? this.#scope() : {}),
      line: event.sourceSpan.start.line,
      column: event.sourceSpan.start.col,
    });
  }

  override visitTextAttribute(attribute: TmplAstTextAttribute): void {
    if (attribute.name !== 'routerLink') return;
    this.#add({
      name: 'routerLink',
      kind: 'route',
      source: attribute.value,
      handlers: [],
      route: attribute.value,
      line: attribute.sourceSpan.start.line,
      column: attribute.sourceSpan.start.col,
    });
  }

  override visitBoundAttribute(attribute: TmplAstBoundAttribute): void {
    if (attribute.name !== 'routerLink') return;
    const source = String((attribute.value as { source?: string }).source ?? '');
    const address = addressOf(attribute.value, source);
    this.#add({
      name: 'routerLink',
      kind: 'route',
      source,
      handlers: [],
      route: routeOfExpression(attribute.value, this.#placeholder),
      ...(address === undefined ? {} : { address, ...this.#scope() }),
      line: attribute.sourceSpan.start.line,
      column: attribute.sourceSpan.start.col,
    });
  }
}

/**
 * Every trigger a component template carries.
 *
 * Parsed with the framework's own compiler rather than matched with a pattern:
 * a binding inside `*ngIf`, `@if` or `<ng-template>` is written exactly like one
 * anywhere else and is reached the same way, and `(keyup.enter)` is one event
 * name rather than two. Positions come back offset into `file`, so the id of a
 * trigger is where a reader will find it whether the template is a file of its
 * own or a string inside the component.
 */
export const parseAngularTemplate = (
  source: string,
  file: string,
  options: ParseTemplateOptions = {},
): TemplateEvent[] => readAngularTemplate(source, file, options).events;

/** A template's triggers and the elements it writes (P370), from one parse. */
export const readAngularTemplate = (
  source: string,
  file: string,
  options: ParseTemplateOptions = {},
): { events: TemplateEvent[]; elements: TemplateElement[] } => {
  const parsed = parseTemplate(source, file, { preserveWhitespaces: false });
  const collector = new EventCollector(
    options.placeholder ?? DEFAULT_PLACEHOLDER,
    localsOf(parsed.nodes),
  );
  tmplAstVisitAll(collector, parsed.nodes);
  const elements = new ElementCollector();
  tmplAstVisitAll(elements, parsed.nodes);

  const startLine = options.startLine ?? 1;
  const startColumn = options.startColumn ?? 1;

  for (const error of parsed.errors ?? []) {
    options.onError?.(error.msg, (error.span.start.line ?? 0) + startLine);
  }

  const events = collector.events
    .map((event) => ({
      ...event,
      line: event.line + startLine,
      column: event.line === 0 ? event.column + startColumn : event.column + 1,
    }))
    .sort((a, b) => a.line - b.line || a.column - b.column || (a.name < b.name ? -1 : 1));
  return { events, elements: elements.elements.map((element) => ({ ...element, line: element.line + startLine })) };
};
