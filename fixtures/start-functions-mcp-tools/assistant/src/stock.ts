/** Answers the `stock_level` tool: registered by name, so the graph points here. */
export async function lookupStock({ sku }: { sku: string }) {
  return { content: [{ type: 'text' as const, text: `${sku}: 4 left` }] };
}
