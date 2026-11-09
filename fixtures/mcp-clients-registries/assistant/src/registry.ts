import type { Tool } from './tools/define.js';
import { countOrdersTool } from './tools/count-orders.js';
import { refundOrderTool } from './tools/refund-order.js';

/** One thing the server may offer, whichever the configuration turns on. */
export type Item =
  | { type: 'tool'; wireName: string; tool: Tool }
  | { type: 'prompt'; wireName: string; prompt: { handler: () => Promise<{ messages: [] }> } };

/** The built-in tools, each under the name a client asks for it by. */
export const BUILTIN_TOOLS = {
  count: { wireName: 'countOrders', tool: countOrdersTool },
  refund: { wireName: 'refundOrder', tool: refundOrderTool },
};

/** Which items run is the configuration's business, at run time. */
export const itemsFor = (enabled: readonly string[], prompts: Record<string, Item & { type: 'prompt' }>): Item[] => [
  ...Object.entries(BUILTIN_TOOLS)
    .filter(([key]) => enabled.includes(key))
    .map(([, { wireName, tool }]): Item => ({ type: 'tool', wireName, tool })),
  ...Object.values(prompts),
];
