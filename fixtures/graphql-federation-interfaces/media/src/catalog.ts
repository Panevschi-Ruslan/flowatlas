export interface Item {
  __typename: 'Book' | 'Movie';
  id: string;
  title: string;
}

const items = new Map<string, Item>();
const directors = new Map<string, string>();

export const allMedia = (): Item[] => [...items.values()];

/** The item with the type it is, which is what an entity call for a Media is answered with. */
export const mediaById = (id: string): Item | undefined => items.get(id);

export const directorOf = (id: string): string => directors.get(id) ?? '';
