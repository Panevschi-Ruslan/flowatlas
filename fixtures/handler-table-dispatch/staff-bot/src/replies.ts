import type { Context } from 'telegraf';

import type { StaffApi } from './staff.api';

/** `/help`: a function of its own, held by the commands table. */
export const replyHelp = async (ctx: Context): Promise<void> => {
  await ctx.reply('Commands: /orders, /help; type "stock" or "ping".');
};

/** `stock`: a function of its own, held by the text commands table. */
export async function replyStock(ctx: Context, api: StaffApi): Promise<void> {
  const stock = await api.getStock();
  await ctx.reply(`${stock.items} items in stock`);
}
