import { initTRPC } from '@trpc/server';

const t = initTRPC.create();

// The library's root, taken apart and published under this project's own names.
// This is the ordinary shape, and it is why nothing downstream can recognise a
// router by the type of the value it is assembled on: from here on, `router` is
// a function of this file.
export const router = t.router;
export const middleware = t.middleware;
export const procedure = t.procedure;
