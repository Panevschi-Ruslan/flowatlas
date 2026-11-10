import { redirect } from '@sveltejs/kit';

/** The menu's load: a kiosk that is closed sends the visitor back to the start. */
export async function load({ url }: { url: URL }) {
  if (url.searchParams.has('closed')) redirect(303, '/');
  return { items: ['tea', 'cake'] };
}
