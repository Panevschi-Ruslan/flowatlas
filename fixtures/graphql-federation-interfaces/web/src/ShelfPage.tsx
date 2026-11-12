import { gql, useQuery } from '@apollo/client';

const SHELF = gql`
  query Shelf {
    media {
      title
      reviews {
        score
      }
      ... on Book {
        author
        rating
      }
      ... on Movie {
        director
      }
    }
  }
`;

export const ShelfPage = () => {
  const { data } = useQuery(SHELF);
  return (
    <ul>
      {data?.media.map((item: { title: string }) => (
        <li key={item.title}>{item.title}</li>
      ))}
    </ul>
  );
};
