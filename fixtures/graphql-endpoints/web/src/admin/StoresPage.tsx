import { gql, useQuery } from '@apollo/client';

import { adminClient } from './adminClient';

const STORES = gql`
  query Stores {
    stores {
      id
      name
    }
  }
`;

export const StoresPage = () => {
  const { data } = useQuery(STORES, { client: adminClient });
  return <ul>{data?.stores.map((store: { id: string; name: string }) => <li key={store.id}>{store.name}</li>)}</ul>;
};
