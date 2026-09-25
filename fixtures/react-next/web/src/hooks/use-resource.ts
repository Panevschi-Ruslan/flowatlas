const base = import.meta.env.VITE_API_URL;

/**
 * A request whose address only the caller knows, and whose caller does not know
 * it either.
 *
 * The tail comes from a property of the screen, which comes from whatever
 * rendered the screen, which is markup and not a call. Following the address
 * outward therefore settles nothing, and the right answer is one row saying the
 * address is built at run time — not a silence, and not a guess at a path.
 */
export const useResource = (path: string) => {
  const load = async (): Promise<unknown> => {
    const answer = await fetch(`${base}${path}`);
    return answer.json();
  };
  return { load };
};
