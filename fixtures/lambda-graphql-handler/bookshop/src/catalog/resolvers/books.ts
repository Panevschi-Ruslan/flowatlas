import { findBook, listBooks, saveBook } from '../store';

export const bookResolvers = {
  Query: {
    book: async (_parent: unknown, args: { id: string }) => findBook(args.id),
    books: () => listBooks(),
  },
  Mutation: {
    addBook: async (_parent: unknown, args: { title: string }) => saveBook(args.title),
  },
};
