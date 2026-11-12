import { defineTool, type ToolAnswer } from './define.js';

async function refundOrder(input: Record<string, unknown>): Promise<ToolAnswer> {
  return { content: [{ type: 'text', text: `refunded ${String(input['orderId'])}` }] };
}

/** Defined by the builder and handed a function declared beside it. */
export const refundOrderTool = defineTool({ description: 'Refund one order' }).handler(refundOrder);
