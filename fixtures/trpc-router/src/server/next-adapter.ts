import { createNextApiHandler as handlerFor } from '@trpc/server/adapters/next';
import type { AnyRouter } from '@trpc/server';

/**
 * The project's own wrapper, which is how a real repository spells this.
 *
 * The library's adapter takes an options object; a wrapper takes the tree alone,
 * so both spellings of the same mount exist in the wild and the reading has to
 * survive the one that hides the other.
 */
export const createNextApiHandler = (router: AnyRouter) =>
  handlerFor({ router, createContext: () => ({}) });
