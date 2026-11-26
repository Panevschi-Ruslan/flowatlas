interface Book {
  id: string;
  title: string;
}

const books = new Map<string, Book>();

export const findBook = async (id: string): Promise<Book | undefined> => books.get(id);

export const listBooks = async (): Promise<Book[]> => [...books.values()];

export const saveBook = async (title: string): Promise<Book> => {
  const book = { id: String(books.size + 1), title };
  books.set(book.id, book);
  return book;
};

export const findAuthor = async (id: string): Promise<{ id: string; name: string }> => ({ id, name: 'Unknown' });
