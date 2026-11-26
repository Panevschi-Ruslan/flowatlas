import { resolveStaticString, UNREAD_SPAN } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { buttonDataOf } from './bot-buttons.js';

/** The callback data of every button a sample builds, as written. */
const dataIn = (text: string): string[] => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  const file = project.createSourceFile('/bot/src/a.ts', text);
  const found: string[] = [];
  file.forEachDescendant((node) => {
    const data = buttonDataOf(node);
    if (data !== undefined) found.push(resolveStaticString(data)?.value ?? UNREAD_SPAN);
  });
  return found;
};

/** The buttons a bot sends (P388). */
describe('the callback data a button sends', () => {
  it('reads the frameworks’ buttons and the platform’s own object, a template with its holes standing in', () => {
    expect(
      dataIn(`
        Markup.inlineKeyboard([Markup.button.callback('Confirm', 'order:confirm'), Markup.button.callback('Cancel', \`order:cancel:\${id}\`)]);
        Markup.callbackButton('Old', 'legacy:open');
        new InlineKeyboard().text('Next', 'page:next');
        const raw = { reply_markup: { inline_keyboard: [[{ text: 'Track', callback_data: 'order:track' }]] } };
        const opaque = { text: 'More', callback_data: computeData() };
      `),
    ).toEqual(['order:confirm', 'order:cancel:${…}', 'legacy:open', 'page:next', 'order:track', '${…}']);
  });

  it('leaves out what builds no button', () => {
    expect(dataIn("emitter.callback('a', 'b'); const row = { callback_data: 'x' }; keyboard.text('label');")).toEqual([]);
  });
});
