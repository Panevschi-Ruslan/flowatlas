import { HttpLink } from 'apollo-angular/http';
import { InMemoryCache } from '@apollo/client/core';

import { environment } from '../environments/environment';

export const apolloOptions = (httpLink: HttpLink) => ({
  link: httpLink.create({ uri: `${environment.apiUrl}/graphql` }),
  cache: new InMemoryCache(),
});
