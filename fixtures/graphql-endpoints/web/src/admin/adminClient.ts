import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';

import { SERVER_URL } from '../config';

export const adminClient = new ApolloClient({
  link: new HttpLink({ uri: `${SERVER_URL}/admin` }),
  cache: new InMemoryCache(),
});
