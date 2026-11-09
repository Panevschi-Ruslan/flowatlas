import { ApolloClient, InMemoryCache } from '@apollo/client';
import { useMemo } from 'react';

import { SERVER_URL } from '../config';

/** A client of the storefront's schema, unless the options name another address. */
export const useClientFactory = (options: { uri?: string } = {}) =>
  useMemo(
    () =>
      new ApolloClient({
        uri: `${SERVER_URL}/graphql`,
        cache: new InMemoryCache(),
        ...options,
      }),
    [],
  );
