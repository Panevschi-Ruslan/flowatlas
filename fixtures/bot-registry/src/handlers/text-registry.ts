import type { BotDeps } from './callback-registry.js';

type TextHandler = (deps: BotDeps) => void;

const replies = new Map<string, TextHandler>();

const on = (phrase: string, handler: TextHandler): void => {
  replies.set(phrase, handler);
};

/** A second table, deliberately left out of the configuration. */
export const textRegistry = { on };

export function helpText({ orders }: BotDeps): void {
  orders.find('help');
}

textRegistry.on('help', helpText);
textRegistry.on('support', ({ orders }) => {
  orders.find('support');
});
