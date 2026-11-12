import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

/** The client, made with no transport and connected to one afterwards. */
const assistant = new Client({ name: 'concierge', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(`${process.env.ASSISTANT_URL}/mcp`));

export const connect = async (): Promise<void> => {
  await assistant.connect(transport);
};

/** A tool registered under a name written as text. */
export const cancel = (orderId: string) => assistant.callTool({ name: 'cancel_order', arguments: { orderId } });

/** A tool the server registers under the name its registry's record carries. */
export const countOrders = () => assistant.callTool({ name: 'countOrders', arguments: {} });

/** A tool whose name the server writes in part: matched by the written part. */
export const findProducts = () => assistant.callTool({ name: 'findProducts' });

/** A resource a template's URI matches. */
export const order = (id: string) => assistant.readResource({ uri: 'shop://orders/42' });

/** A prompt nobody registers: a request nothing answers. */
export const summary = () => assistant.getPrompt({ name: 'summarise_order' });

/** A name worked out at run time: a row, not an edge. */
export const run = (name: string) => assistant.callTool({ name, arguments: {} });
