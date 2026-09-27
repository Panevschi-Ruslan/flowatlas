import { Telegraf } from 'telegraf';

/**
 * Methods every object has, called on a bot.
 *
 * None of these registers anything, and the graph must hold no node for any
 * line of this file. The registration methods are read by looking the method's
 * name up in a table, and a table written as an object literal answers
 * `toString`, `valueOf`, `constructor`, `hasOwnProperty` and `__proto__` with
 * the language's own values. Before this was closed, one `bot.toString()` made
 * the entry id throw and the whole repository read as nothing at all.
 *
 * A module-level function that no handler calls earns no node, so "no node
 * anywhere names this file" is a statement about the whole graph.
 */
export const describeBot = (bot: Telegraf): string => {
  const shown = bot.toString();
  const same = bot.valueOf();
  const made = bot.constructor();
  const owns = bot.hasOwnProperty('start');
  // @ts-expect-error - declared on no type, and still a word the source can hold.
  const proto = bot.__proto__();
  return `${shown}${String(same)}${String(made)}${String(owns)}${String(proto)}`;
};
