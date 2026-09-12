import {
  ASTWithSource,
  Call,
  Chain,
  ImplicitReceiver,
  parseTemplate,
  PropertyRead,
  SafeCall,
  SafePropertyRead,
  ThisReceiver,
  TmplAstRecursiveVisitor,
  tmplAstVisitAll,
  type AST,
  type TmplAstBoundAttribute,
  type TmplAstBoundEvent,
  type TmplAstTextAttribute,
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

/** What the handler expression turned out to be. */
export type TemplateHandler =
  | { readonly kind: 'method'; readonly method: string; readonly args: string[] }
  | {
      readonly kind: 'member';
      readonly property: string;
      readonly method: string;
      readonly args: string[];
    }
  | { readonly kind: 'other'; readonly text: string };

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
  /** 1-based, already offset into the file the template lives in. */
  line: number;
  column: number;
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

const KIND_BY_EVENT: Record<string, TemplateEventKind> = {
  click: 'click',
  submit: 'submit',
  ngsubmit: 'submit',
  change: 'change',
  ngmodelchange: 'change',
  input: 'input',
};

const DEFAULT_PLACEHOLDER = ':param';

const kindOf = (name: string): TemplateEventKind => {
  const lowered = name.toLowerCase();
  if (lowered.startsWith('keyup') || lowered.startsWith('keydown')) return 'keyup';
  return KIND_BY_EVENT[lowered] ?? 'custom';
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
const handlersOf = (handler: AST): TemplateHandler[] => {
  const root = handler instanceof ASTWithSource ? handler.ast : handler;
  const written = root instanceof Chain ? root.expressions : [root];
  const text = String((handler as { source?: string }).source ?? '');
  const argsOf = (call: Call | SafeCall): string[] =>
    call.args.map((argument) => text.slice(argument.span.start, argument.span.end));

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
    if (receiver instanceof ThisReceiver || receiver instanceof ImplicitReceiver) {
      return { kind: 'method', method: callee.name, args: argsOf(expression) };
    }
    if (
      (receiver instanceof PropertyRead || receiver instanceof SafePropertyRead) &&
      receiver.receiver instanceof ImplicitReceiver
    ) {
      return {
        kind: 'member',
        property: receiver.name,
        method: callee.name,
        args: argsOf(expression),
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
  if (!Array.isArray(literal.expressions)) return null;
  const parts = literal.expressions.map((element) => {
    const value = (element as { value?: unknown }).value;
    return typeof value === 'string' ? value : placeholder;
  });
  return parts.length === 0 ? null : parts.join('/').replace(/\/{2,}/g, '/');
};

class EventCollector extends TmplAstRecursiveVisitor {
  readonly events: TemplateEvent[] = [];
  readonly #seen = new Set<string>();
  readonly #placeholder: string;

  constructor(placeholder: string) {
    super();
    this.#placeholder = placeholder;
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
    this.#add({
      name: event.name,
      kind: kindOf(event.name),
      source: String((event.handler as { source?: string }).source ?? ''),
      handlers: handlersOf(event.handler),
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
    this.#add({
      name: 'routerLink',
      kind: 'route',
      source: String((attribute.value as { source?: string }).source ?? ''),
      handlers: [],
      route: routeOfExpression(attribute.value, this.#placeholder),
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
): TemplateEvent[] => {
  const parsed = parseTemplate(source, file, { preserveWhitespaces: false });
  const collector = new EventCollector(options.placeholder ?? DEFAULT_PLACEHOLDER);
  tmplAstVisitAll(collector, parsed.nodes);

  const startLine = options.startLine ?? 1;
  const startColumn = options.startColumn ?? 1;

  for (const error of parsed.errors ?? []) {
    options.onError?.(error.msg, (error.span.start.line ?? 0) + startLine);
  }

  return collector.events
    .map((event) => ({
      ...event,
      line: event.line + startLine,
      column: event.line === 0 ? event.column + startColumn : event.column + 1,
    }))
    .sort((a, b) => a.line - b.line || a.column - b.column || (a.name < b.name ? -1 : 1));
};
