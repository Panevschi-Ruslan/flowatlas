import { GraphQLClient } from 'graphql-request';
import { getSdk } from './generated';
import { createStoreHooks } from './generated/sdk';

const client = new GraphQLClient('/graphql');

/** `getSdk`, through the barrel that re-exports everything the generated module does. */
export const storeApi = getSdk(client);

/** The SWR factory, written out under the name the configuration's `add` plugin gives it. */
export const storeHooks = createStoreHooks(client);
