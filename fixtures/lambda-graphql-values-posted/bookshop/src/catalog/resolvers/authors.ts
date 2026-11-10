import { findAuthor } from '../store';

/** A resolver declared under its own name and handed to the map by it. */
const author = async (_parent: unknown, args: { id: string }) => findAuthor(args.id);

export const authorResolvers = {
  Query: { author },
};
