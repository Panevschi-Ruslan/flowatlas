/**
 * A handler named for a verb, in a file no file-system router serves. An
 * application's own route file imports it and wraps it; this file is not a way
 * in, and a counting rule that counted it would be counting a function by its
 * name.
 */
export async function GET(): Promise<Response> {
  return new Response('ok');
}
