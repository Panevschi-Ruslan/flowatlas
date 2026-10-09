import type { LoaderFunctionArgs } from '@remix-run/node';

/** `$` alone is the rest of the path. */
export const loader = ({ params }: LoaderFunctionArgs) => new Response(params['*'] ?? '');
