import { redirect, type ActionFunctionArgs } from '@remix-run/node';

/** `_auth` is a layout that adds no segment: `/login`. */
export async function action({ request }: ActionFunctionArgs) {
  await request.json();
  return redirect('/');
}
