/**
 * One wrapper for every session request: the verb is the one the caller's
 * init writes, or POST where the caller hands none.
 */
export async function send(path: string, payload?: unknown, init?: RequestInit): Promise<unknown> {
  const method = init?.method || 'POST';
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
    ...init,
  });
  return response.json();
}
