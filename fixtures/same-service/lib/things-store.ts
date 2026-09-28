/** Somewhere for the route handlers to end, so the edge has a tail as well as a head. */
const things: Array<{ id: string; name: string }> = [];

export const listThings = async (): Promise<Array<{ id: string; name: string }>> => things;

export const saveThing = async (thing: { id: string; name: string }): Promise<{ id: string; name: string }> => {
  things.push(thing);
  return thing;
};
