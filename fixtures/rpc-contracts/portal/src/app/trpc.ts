import { InjectionToken } from '@angular/core';
import { createTRPCClient, httpBatchLink } from '@trpc/client';

/** A client made at the top of a module, which a component calls by name. */
export const billing = createTRPCClient<any>({ links: [httpBatchLink({ url: '/trpc' })] });

/** The token a service is handed the same kind of client by. */
export const TRPC = new InjectionToken<any>('trpc');

/** What the application is configured with: the client, built in a factory, provided for the token. */
export const appConfig = {
  providers: [{ provide: TRPC, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: '/trpc' })] }) }],
};
