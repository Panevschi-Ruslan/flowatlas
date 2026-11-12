import { gql, useQuery } from '@apollo/client';

const TOP = gql`
  query TopBooks {
    topProducts {
      reviews {
        score
      }
      ... on Book {
        details {
          pages
        }
      }
    }
  }
`;

export const TopBooks = () => {
  const { data } = useQuery(TOP);
  return <p>{data?.topProducts.length} books</p>;
};
