import { listThings, saveThing } from '../../../lib/things-store';

/** The route the screen next door asks for, in the same repository. */
export async function GET(): Promise<Response> {
  return Response.json(await listThings());
}

export async function POST(request: Request): Promise<Response> {
  return Response.json(await saveThing(await request.json()));
}
