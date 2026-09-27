/**
 * Everything else this application answers under `/api`.
 *
 * payload's shape: every application in it declares one of these, which is why
 * reading the router root wherever it occurred made one application's catch-all
 * the answer to every other application's requests.
 */
export async function GET(): Promise<Response> {
  return Response.json([]);
}
