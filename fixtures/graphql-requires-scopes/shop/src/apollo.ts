import { ApolloClient, InMemoryCache } from '@apollo/client';

export const client = new ApolloClient({ uri: `${import.meta.env.VITE_ROUTER_URL}/graphql`, cache: new InMemoryCache() });
