import { OrdersService } from '../orders.service.js';

/**
 * Everything a handler is handed, in one argument.
 *
 * The services arrive destructured out of this rather than injected into a
 * class, which is the shape that made a handler look like it called nothing.
 */
export interface BotDeps {
  orders: OrdersService;
}

type CallbackHandler = (data: string, deps: BotDeps) => void;

const handlers = new Map<string, CallbackHandler>();

const register = (prefix: string, handler: CallbackHandler): void => {
  handlers.set(prefix, handler);
};

const dispatch = (data: string, deps: BotDeps): boolean => {
  for (const [prefix, handler] of handlers) {
    if (data === prefix || data.startsWith(`${prefix}_`)) {
      handler(data, deps);
      return true;
    }
  }
  return false;
};

/** The table itself. Nothing in a manifest says this exists. */
export const callbackRegistry = { register, dispatch };
