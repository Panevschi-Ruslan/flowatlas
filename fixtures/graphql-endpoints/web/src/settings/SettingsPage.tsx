import { gql, useMutation, useQuery } from '@apollo/client';

const SHOP_SETTINGS = gql`
  query ShopSettings {
    me {
      id
      email
    }
    shopSettings {
      name
      currency
    }
  }
`;

const RENAME_SHOP = gql`
  mutation RenameShop($name: String!) {
    renameShop(name: $name) {
      name
    }
  }
`;

/** Sent with the page's client: the settings schema. */
export const SettingsPage = () => {
  const { data } = useQuery(SHOP_SETTINGS);
  const [rename] = useMutation(RENAME_SHOP);
  return (
    <form onSubmit={() => rename({ variables: { name: 'renamed' } })}>
      <p>{data?.me.email}</p>
      <p>{data?.shopSettings.name}</p>
    </form>
  );
};
