/**
 * The guard equivalent: one function in front of everything the matcher covers.
 *
 * The matcher is written as a path pattern rather than as a regular expression,
 * which is what lets the reader say which routes it covers. A repository that
 * writes a regular expression here gets a row saying so instead, because a
 * guard nobody read is not a guard anybody should be told about.
 */
export const config = { matcher: ['/api/:path*'] };

export function middleware(request: { headers: { get(name: string): string | null } }): Response | undefined {
  const token = request.headers.get('authorization');
  if (token === null) return new Response('unauthorized', { status: 401 });
  return undefined;
}
