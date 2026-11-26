import { GraphQLClient } from 'graphql-request';

import { createStoreApi, getSdkWithHooks } from '../generated';

const client = new GraphQLClient('/shop-graphql');

export const storeApi = createStoreApi(client);
export const storeHooks = getSdkWithHooks(client);
