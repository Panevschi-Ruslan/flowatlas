import type { ApolloClient } from '@apollo/client';
import { createContext, useContext, type ReactNode } from 'react';

import { useClientFactory } from './useClientFactory';

export const StoreClientContext = createContext<ApolloClient<unknown> | null>(null);

/** Hands the storefront's client down to the screens that send their operations with it. */
export const StoreClientProvider = ({ children }: { children: ReactNode }) => {
  const storeClient = useClientFactory();
  return <StoreClientContext.Provider value={storeClient}>{children}</StoreClientContext.Provider>;
};

export const useStoreClient = () => {
  const client = useContext(StoreClientContext);
  if (client === null) throw new Error('no storefront client');
  return client;
};
