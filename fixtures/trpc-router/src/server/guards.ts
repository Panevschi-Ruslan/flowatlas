import { middleware } from './trpc';

export const isSignedIn = middleware(({ ctx, next }) => next({ ctx }));

export const isAdmin = middleware(({ ctx, next }) => next({ ctx }));
