import { callbackRegistry, type BotDeps } from '../handlers/callback-registry.js';
import { summarise } from './summary.js';

/** Named, so the button can be pointed at the code it runs. */
function confirmCancelHandler(data: string, { orders }: BotDeps): void {
  const orderId = data.replace('confirm_cancel_', '');
  orders.cancel(orderId);
}

/** One hop further: a handler that reaches its service through a helper. */
function viewOrderHandler(data: string, deps: BotDeps): void {
  summarise(data.replace('view_order_', ''), deps);
}

callbackRegistry.register('confirm_cancel', confirmCancelHandler);
callbackRegistry.register('view_order', viewOrderHandler);

// Written in place, so there is no name to point at and the flow stops here.
callbackRegistry.register('keep_order', (data, { orders }) => {
  orders.find(data);
});

// Computed, so the button cannot be named.
callbackRegistry.register(`rate_${String(Date.now())}`, confirmCancelHandler);
