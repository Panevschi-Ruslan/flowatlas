import { gql, useQuery } from '@apollo/client';

const BOOK = gql`
  query Book($id: ID!) {
    book(id: $id) {
      name
      price
      details {
        pages
        edition {
          year
        }
      }
    }
  }
`;

export const BookPage = ({ id }: { id: string }) => {
  const { data } = useQuery(BOOK, { variables: { id } });
  return <p>{data?.book?.name}</p>;
};
