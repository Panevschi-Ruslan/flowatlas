import { definePass, resolveStaticString, UNREAD_SPAN, type ExtractorPass } from '@flowatlas/core';
import { repoSourceFiles, scopesOf, type PassContext } from '@flowatlas/extract-scopes';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/**
 * The buttons a bot sends (P388): what each one hands back when it is
 * pressed, read where the keyboard is built, so the handlers registered for
 * callback data can be held against the buttons that send it.
 *
 * A button is `Markup.button.callback(text, data)` (Telegraf),
 * `Markup.callbackButton(text, data)` (older Telegraf), `keyboard.text(label,
 * data)` on grammY's `InlineKeyboard`, or an object of the platform's own
 * shape, `{ text, callback_data }`. Its data is kept as written: a string,
 * or a template with the parts not read standing in (`order:${…}`). A button
 * whose data is a value not read at all is kept too, as nothing but the stand-in,
 * so a reader of the buttons knows something was there.
 *
 * Each button is written on the node of the function it is built in
 * (`meta.callbackButtons`). One built where no function the reading draws
 * holds it - at a module's top level - is a row, never silence: a handler
 * that only it triggers would otherwise read as one no button triggers.
 */

/** On a method or function: the buttons it builds, each with what pressing it sends back. */
export const CALLBACK_BUTTONS_META = 'callbackButtons';

/** One button, as built. */
export interface CallbackButton {
  /** What it sends back; parts not read stand in as `${…}`. */
  readonly data: string;
  /** `file:line` of where it is built. */
  readonly at: string;
}

/** The value a call or an object sends back when its button is pressed, if it builds one. */
export const buttonDataOf = (node: TsNode): TsNode | undefined => {
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const name = callee.getName();
    const receiver = callee.getExpression().getText();
    const args = node.getArguments();
    // `Markup.button.callback(text, data)`, and `button.callback` where `button` is taken from it.
    if (name === 'callback' && /(^|\.)button$/.test(receiver)) return args[1];
    // `Markup.callbackButton(text, data)`, Telegraf before version 4.
    if (name === 'callbackButton' && /(^|\.)Markup$/.test(receiver)) return args[1];
    // grammY: `new InlineKeyboard().text(label, data)`, chained.
    if (name === 'text' && args.length >= 2 && /InlineKeyboard/.test(receiver)) return args[1];
    return undefined;
  }
  if (Node.isObjectLiteralExpression(node)) {
    let data: TsNode | undefined;
    let text = false;
    for (const property of node.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const key = property.getNameNode();
      const name = Node.isIdentifier(key) ? key.getText() : Node.isStringLiteral(key) ? key.getLiteralText() : '';
      if (name === 'callback_data') data = property.getInitializer();
      if (name === 'text') text = true;
    }
    return text ? data : undefined;
  }
  return undefined;
};

/** What a button's data is written as: the string, with what was not read standing in. */
const writtenData = (node: TsNode): string => resolveStaticString(node)?.value ?? UNREAD_SPAN;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Reads the buttons of every body of the repository and writes them on the node each is built in. */
export const extractBotButtons = (ctx: PassContext): void => {
  const placed = new Set<TsNode>();
  for (const scope of scopesOf(ctx)) {
    const found: CallbackButton[] = [];
    const visit = (node: TsNode): void => {
      if (placed.has(node)) return;
      const data = buttonDataOf(node);
      if (data === undefined) return;
      placed.add(node);
      found.push({ data: writtenData(data), at: `${scope.file}:${node.getStartLineNumber()}` });
    };
    scope.body.forEachDescendant((node, traversal) => {
      if (scope.leaveOut?.has(node) === true) {
        traversal.skip();
        return;
      }
      visit(node);
    });
    if (found.length === 0) continue;
    scope.ensure();
    const holder = ctx.builder.getNode(scope.id);
    if (holder === undefined) continue;
    const known = Array.isArray(holder.meta?.[CALLBACK_BUTTONS_META]) ? (holder.meta[CALLBACK_BUTTONS_META] as CallbackButton[]) : [];
    const all = [...known, ...found].filter((each, index, list) => list.findIndex((other) => other.at === each.at && other.data === each.data) === index);
    holder.meta = { ...holder.meta, [CALLBACK_BUTTONS_META]: all.sort((a, b) => byText(a.at, b.at) || byText(a.data, b.data)) };
  }
  // Buttons no body the reading draws holds: said, so no handler reads as untriggered for want of them.
  for (const source of repoSourceFiles(ctx)) {
    if (!/callback_data|button\.callback|callbackButton|InlineKeyboard/.test(source.getFullText())) continue;
    source.forEachDescendant((node) => {
      if (placed.has(node) || buttonDataOf(node) === undefined) return;
      placed.add(node);
      ctx.report({
        file: ctx.fileOf(node),
        line: node.getStartLineNumber(),
        reason: 'bot-button-unplaced',
        level: 'info',
        message: 'A bot button is built here, outside any function the reading draws, so the callback data it sends is not held against the handlers.',
        hint: 'Build the keyboard in a function or a method.',
        symbol: node.getText().replace(/\s+/g, ' ').slice(0, 80),
      });
    });
  }
};

export const botButtonsPass: ExtractorPass<PassContext> = definePass('bot-buttons', extractBotButtons);
