export interface Book {
  id: string;
  name: string;
  price: number;
  cost: number;
}

export interface Details {
  pages: number;
  edition: { year: number };
}

const books = new Map<string, Book>();
const details = new Map<string, Details>();

/** A book as stored: its price and cost are answered from here, by no resolver of their own. */
export const bookById = (id: string): Book | undefined => books.get(id);

export const allBooks = (): Book[] => [...books.values()];

export const detailsOf = (id: string): Details => details.get(id) ?? { pages: 0, edition: { year: 0 } };
