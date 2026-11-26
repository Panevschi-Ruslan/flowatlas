import { authorResolvers } from './resolvers/authors';
import { bookResolvers } from './resolvers/books';

/** One map, put together a type at a time out of the maps each module keeps. */
export const resolvers = {
  Query: {
    ...bookResolvers.Query,
    ...authorResolvers.Query,
  },
  Mutation: {
    ...bookResolvers.Mutation,
  },
};
