import { defineTool } from './define.js';

/** Defined by the builder; served under the name the registry gives it. */
export const countOrdersTool = defineTool({ description: 'Count the orders matching a filter' }).handler(async (input) => ({
  content: [{ type: 'text', text: `${Object.keys(input).length} filters, 3 orders` }],
}));
