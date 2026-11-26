/** What a tool answers with. */
export interface ToolAnswer {
  content: Array<{ type: 'text'; text: string }>;
}

export interface Tool {
  description: string;
  handler: (input: Record<string, unknown>) => Promise<ToolAnswer>;
}

/**
 * A two-stage builder of the repository's own: the description first, the
 * function that answers second, `defineTool({ description }).handler(fn)`.
 */
export const defineTool = (args: Omit<Tool, 'handler'>): { handler: (fn: Tool['handler']) => Tool } => ({
  handler: (fn) => ({ ...args, handler: fn }),
});
