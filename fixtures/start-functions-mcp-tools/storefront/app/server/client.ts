/**
 * A client the application builds around one server function it is handed
 * (P277): whatever calls the client crosses the boundary through `runOnServer`.
 */
export function createOrdersClient({
  runOnServer,
}: {
  runOnServer: (input: { data: unknown }) => Promise<unknown>;
}): (args: unknown) => Promise<unknown> {
  return async (args: unknown) => runOnServer({ data: args });
}
