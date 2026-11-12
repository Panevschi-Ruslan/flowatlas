import { createMiddleware } from '@tanstack/react-start';

/** Runs on the server in front of every server function that installs it. */
export const requireSession = createMiddleware().server(async ({ next }) => next());
