import { gql, useQuery } from '@apollo/client';

const PRODUCTS = gql`
  query Products {
    products {
      id
      name
      price
    }
  }
`;

export const Products = () => {
  const { data } = useQuery(PRODUCTS);
  return (
    <ul>
      {data?.products.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
};
