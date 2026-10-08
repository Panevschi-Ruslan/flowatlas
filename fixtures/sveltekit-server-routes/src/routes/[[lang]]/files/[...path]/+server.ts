import type { RequestEvent } from '@sveltejs/kit';

/** An optional param and the rest of the path. */
export function GET({ params }: RequestEvent) {
  return new Response(params.path ?? '');
}
