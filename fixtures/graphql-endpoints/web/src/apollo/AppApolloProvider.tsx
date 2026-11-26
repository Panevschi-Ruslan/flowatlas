import { ApolloProvider } from '@apollo/client';
import type { ReactNode } from 'react';

import { SERVER_URL } from '../config';
import { useClientFactory } from './useClientFactory';

/** The client the whole page is wrapped in: the settings schema's. */
export const AppApolloProvider = ({ children }: { children: ReactNode }) => {
  const client = useClientFactory({ uri: `${SERVER_URL}/settings` });
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
};
