import type { EntryHandler, EntryKind, EntryNode, ExtractContext, TableDispatch, TableRow } from '@flowatlas/core';
import { makeEntryId, resolveTypeOrigin, startLineOf, tableDispatchOf, tableDispatchOfName, tableKeyOf, tableTargetOf } from '@flowatlas/core';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { CallbackData } from './nestjs-telegraf/ids.js';
import { BOT_DECORATORS } from './nestjs-telegraf/ids.js';
import { resolveTriggerArg, telegrafDecoratorName } from './nestjs-telegraf/triggers.js';
import { fileOfNode, handlerOf, handlerOfFunction, inlineHandlerOf } from './shared.js';

/**
 * A bot listener that takes every update of a type and hands each to the
 * element of a table its data selects (P399):
 *
 * ```ts
 * bot.on('callback_query', async (ctx) => {
 *   const data = ('data' in ctx.callbackQuery ? ctx.callbackQuery.data : '') || '';
 *   const route = this.buttonRoutes.find((r) => data.startsWith(r.prefix));
 *   if (route) await route.handler(ctx, data);
 * });
 * ```
 *
 * is a way in per element, the one `bot.action(/^view_order_/, ...)` would
 * open for each: keyed by what selects it (`view_order_*` for a prefix, the
 * text for `===`, the pattern for `r.pattern.test(data)`), handled by what the
 * element's handler runs, carrying the callback data it takes so the buttons
 * read beside it (P388) are held against each. The listener itself stays a
 * way in only where it does something besides choosing (code after the table
 * call that runs for every update, a branch for data no element takes).
 *
 * The listener is read the same in both styles of bot: a function handed to
 * `bot.on(update, ...)` on a `Telegraf`, and a method decorated `@On(update)`.
 * Only a table whose every element is written out, its key and its handler
 * read, is split; one with an element not read stays the listener's call
 * through a table (P398), with its gap.
 */

/** A listener's update, and the way in an explicit registration of one element would open. */
interface Generic {
  readonly kind: EntryKind;
  /** The registration that would open it, as `meta.registration` says it: `action`, `hears`, `inlineQuery`. */
  readonly registration: string;
}

/** The updates a listener takes every one of, by the name it is registered under. */
const GENERIC: ReadonlyMap<string, Generic> = new Map([
  ['callback_query', { kind: 'bot_callback', registration: 'action' }],
  ['text', { kind: 'bot_command', registration: 'hears' }],
  ['message', { kind: 'bot_command', registration: 'hears' }],
  ['inline_query', { kind: 'bot_callback', registration: 'inlineQuery' }],
]);

/** One element of the table, as the way in it opens. */
export interface TableRoute {
  readonly key: string;
  readonly kind: EntryKind;
  readonly registration: string;
  /** `prefix view_order_`: how the selection names the element. */
  readonly selectedBy: string;
  /** What a button sends that this element takes, for a callback's way in. */
  readonly callbackData?: CallbackData;
  readonly row: TableRow;
}

/** A listener's table, split into its elements' ways in. */
export interface TableRoutes {
  /** The call through the table the ways in stand for. */
  readonly call: CallExpression;
  readonly dispatch: TableDispatch;
  readonly routes: readonly TableRoute[];
  /** Whether the listener does more than choose: what stays its own way in. */
  readonly rest: boolean;
  /** Whether that rest reads the update's data itself: a branch that may handle data no element takes. */
  readonly restReadsData: boolean;
}

/** A function-like node: an arrow, a function, a method. */
type FunctionLike = TsNode;

const isFunctionLike = (node: TsNode): boolean =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node);

/** A function's body: what it runs, never its decorators or parameters. */
const bodyOf = (fn: FunctionLike): TsNode => (fn as { getBody?: () => TsNode | undefined }).getBody?.() ?? fn;

/** Every call a function's body makes, the body itself where it is one (`(ctx) => route.run(ctx)`). */
const callsIn = (fn: FunctionLike): CallExpression[] => {
  const body = bodyOf(fn);
  return [...(Node.isCallExpression(body) ? [body] : []), ...body.getDescendantsOfKind(SyntaxKind.CallExpression)];
};

/** The function a node is written in, nearest first. */
const functionOf = (node: TsNode): FunctionLike | undefined => node.getFirstAncestor((at) => isFunctionLike(at));

/** The first parameter's name: the update's context in a listener. */
const contextName = (fn: FunctionLike): string | undefined => {
  const parameters = (fn as { getParameters?: () => Array<{ getNameNode(): TsNode }> }).getParameters?.() ?? [];
  const name = parameters[0]?.getNameNode();
  return name !== undefined && Node.isIdentifier(name) ? name.getText() : undefined;
};

/** The local declarations of `fn` an expression reads, followed through their initializers: `data` of `data.startsWith(...)`. */
const localsRead = (expr: TsNode, fn: FunctionLike, into: Set<TsNode>, depth = 0): void => {
  if (depth > 6) return;
  const names = Node.isIdentifier(expr) ? [expr] : expr.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const name of names) {
    const declaration = name.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined || into.has(declaration) || !Node.isVariableDeclaration(declaration)) continue;
    if (functionOf(declaration) !== fn) continue;
    into.add(declaration);
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) localsRead(initializer, fn, into, depth + 1);
  }
};

/** Whether an expression is drawn from the update: it reads the context, itself or through locals of the listener. */
const readsContext = (expr: TsNode, fn: FunctionLike, context: string, locals: ReadonlySet<TsNode>): boolean => {
  const mentions = (node: TsNode): boolean =>
    (Node.isIdentifier(node) ? [node] : node.getDescendantsOfKind(SyntaxKind.Identifier)).some((name) => name.getText() === context);
  if (mentions(expr)) return true;
  for (const declaration of locals) {
    const initializer = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (initializer !== undefined && mentions(initializer)) return true;
  }
  return false;
};

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The key and the callback data of one element, by the test that selects it; undefined for a test this does not read. */
const keyed = (test: string, written: string): { key: string; data: CallbackData } | undefined => {
  switch (test) {
    case 'prefix':
      return { key: `${written}*`, data: { regex: `^${escapeRegex(written)}`, flags: '' } };
    case 'suffix':
      return { key: `*${written}`, data: { regex: `${escapeRegex(written)}$`, flags: '' } };
    case 'contains':
      return { key: `*${written}*`, data: { regex: escapeRegex(written), flags: '' } };
    case 'equals':
      return { key: written, data: written };
    case 'pattern': {
      const regex = /^\/(.*)\/([a-z]*)$/s.exec(written);
      return regex === null ? undefined : { key: written, data: { regex: regex[1]!, flags: regex[2]! } };
    }
    default:
      return undefined;
  }
};

/** The call through a table a function makes in its own body, and the table: undefined where it makes none. */
const dispatchIn = (fn: FunctionLike): { call: CallExpression; dispatch: TableDispatch } | undefined => {
  for (const call of callsIn(fn)) {
    if (functionOf(call) !== fn) continue;
    const callee = call.getExpression();
    const dispatch = Node.isPropertyAccessExpression(callee)
      ? tableDispatchOf(callee.getExpression(), callee.getName(), call)
      : Node.isIdentifier(callee)
        ? tableDispatchOfName(callee, call)
        : undefined;
    if (dispatch !== undefined) return { call, dispatch };
  }
  return undefined;
};

/**
 * The ways in a listener of `update` opens through a table it dispatches over,
 * or undefined where it dispatches over none this splits: the update is not
 * one a listener takes every one of, the selection is not by the update's
 * data, or an element, its key or its handler is not read.
 */
export const tableRoutesIn = (fn: FunctionLike, update: string): TableRoutes | undefined => {
  try {
    const generic = GENERIC.get(update);
    const context = contextName(fn);
    if (generic === undefined || context === undefined) return undefined;
    const found = dispatchIn(fn);
    if (found === undefined) return undefined;
    const { call, dispatch } = found;
    const selection = dispatch.selection;
    if (selection?.subject === undefined || dispatch.unread > 0) return undefined;
    // What the selection reads, and what the element is drawn from: the choosing, apart from the rest.
    const choosing = new Set<TsNode>();
    localsRead(selection.subject, fn, choosing);
    if (!readsContext(selection.subject, fn, context, choosing)) return undefined;
    const subjectLocals = new Set(choosing);
    const callee = call.getExpression();
    localsRead(Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee, fn, choosing);
    const routes: TableRoute[] = [];
    for (const row of dispatch.rows) {
      const written = tableKeyOf(row.element, selection.member);
      const key = written === undefined ? undefined : keyed(selection.test, written);
      if (key === undefined || row.selectedBy === undefined || tableTargetOf(row.value) === undefined) return undefined;
      routes.push({
        key: key.key,
        kind: generic.kind,
        registration: generic.registration,
        selectedBy: row.selectedBy,
        ...(generic.kind === 'bot_callback' && generic.registration === 'action' ? { callbackData: key.data } : {}),
        row,
      });
    }
    if (routes.length === 0) return undefined;
    const inChoosing = (node: TsNode): boolean =>
      node === call || node.getFirstAncestor((at) => at === call || choosing.has(at)) !== undefined;
    // Anything else the listener calls runs for every update: its own way in still.
    const rest = callsIn(fn).some((each) => !inChoosing(each));
    const restReadsData =
      rest &&
      bodyOf(fn)
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .some((name) => !inChoosing(name) && subjectLocals.has(name.getSymbol()?.getDeclarations()[0] as TsNode));
    return { call, dispatch, routes, rest, restReadsData };
  } catch {
    // A question the checker throws on reads as no split, which is what was there before.
    return undefined;
  }
};

/** The package whose type on the receiver makes `x.on(...)` a bot's registration. */
const TELEGRAF = 'telegraf';

/** The update a function is the listener of, in either style: `bot.on('callback_query', fn)` or `@On('callback_query')`. */
export const listenedUpdate = (fn: FunctionLike): string | undefined => {
  if (Node.isMethodDeclaration(fn) && Node.isClassDeclaration(fn.getParent())) {
    for (const decorator of fn.getDecorators()) {
      if (telegrafDecoratorName(decorator, BOT_DECORATORS) !== 'On') continue;
      const argument = decorator.getArguments()[0];
      const resolved = argument === undefined ? undefined : resolveTriggerArg(argument);
      const trigger = resolved?.resolved === true && resolved.triggers.length === 1 ? resolved.triggers[0] : undefined;
      if (trigger?.kind === 'text') return trigger.value;
    }
    return undefined;
  }
  const registration = fn.getParent();
  if (registration === undefined || !Node.isCallExpression(registration) || registration.getArguments()[1] !== fn) return undefined;
  const callee = registration.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'on') return undefined;
  if (resolveTypeOrigin(callee.getExpression())?.package !== TELEGRAF) return undefined;
  const argument = registration.getArguments()[0];
  const resolved = argument === undefined ? undefined : resolveTriggerArg(argument);
  const trigger = resolved?.resolved === true && resolved.triggers.length === 1 ? resolved.triggers[0] : undefined;
  return trigger?.kind === 'text' ? trigger.value : undefined;
};

/**
 * Whether a call is one a bot listener's split table stands for (P399): the
 * call through the table, written in a listener whose elements are ways in
 * of their own. Asked by the call walks through `standsForCall`.
 */
export const isSplitTableCall = (call: TsNode, style: 'call' | 'decorator'): boolean => {
  const fn = functionOf(call);
  if (fn === undefined) return false;
  const decorated = Node.isMethodDeclaration(fn) && Node.isClassDeclaration(fn.getParent());
  if (decorated !== (style === 'decorator')) return false;
  const update = listenedUpdate(fn);
  return update !== undefined && tableRoutesIn(fn, update)?.call === call;
};

/** What one element of a table runs, as the handler of the way in it opens. */
export const handlerOfTarget = (value: TsNode | undefined, label: string, ctx: ExtractContext): EntryHandler | undefined => {
  const target = value === undefined ? undefined : tableTargetOf(value);
  if (target === undefined) return undefined;
  if (target.kind === 'method') return Node.isMethodDeclaration(target.method) ? handlerOf(target.method, ctx) : undefined;
  if (target.kind === 'function') return handlerOfFunction(target.fn, ctx);
  return inlineHandlerOf(target.fn, label, ctx);
};

/** Where a table is written, `file:line`, as a split listener's way in names it. */
export const tableAt = (routes: TableRoutes, ctx: ExtractContext): string => `${fileOfNode(routes.dispatch.table, ctx)}:${startLineOf(routes.dispatch.table)}`;

/**
 * The ways in of a split listener's elements: one per element, at the element
 * as written, keyed and handled as an explicit registration of it would be.
 */
export const tableRouteEntries = (
  ctx: ExtractContext,
  routes: TableRoutes,
  update: string,
  meta: Readonly<Record<string, unknown>>,
): EntryNode[] =>
  routes.routes.map((route) => {
    const label = `${route.kind} ${route.key}`;
    const handler = handlerOfTarget(route.row.value, label, ctx);
    return {
      id: makeEntryId(ctx.repo, route.kind, route.key),
      kind: route.kind,
      label,
      key: route.key,
      ...(handler === undefined ? {} : { handler }),
      file: fileOfNode(route.row.element, ctx),
      line: startLineOf(route.row.element),
      meta: {
        key: route.key,
        ...meta,
        registration: route.registration,
        updateType: update,
        selectedBy: route.selectedBy,
        ...(route.callbackData === undefined ? {} : { callbackData: route.callbackData }),
        handlerVia: 'table',
      },
    };
  });
