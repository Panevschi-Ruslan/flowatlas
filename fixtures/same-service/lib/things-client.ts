/**
 * The requests a browser makes of the server it was served from.
 *
 * No base address and no settings key: a relative path is the whole of what the
 * browser needs, because the page and the route came out of the same
 * deployment. That is exactly why nothing here can name a service, and why the
 * caller's own service has to be part of the question (R93).
 */
export const listThings = async (): Promise<unknown> => {
  const answer = await fetch('/api/things');
  return answer.json();
};

export const createThing = async (name: string): Promise<unknown> => {
  const answer = await fetch('/api/things', { method: 'POST', body: JSON.stringify({ name }) });
  return answer.json();
};

/** A verb no route of this repository answers, so the report still says so. */
export const deleteThing = async (id: string): Promise<unknown> => {
  const answer = await fetch(`/api/things/${id}`, { method: 'DELETE' });
  return answer.json();
};
