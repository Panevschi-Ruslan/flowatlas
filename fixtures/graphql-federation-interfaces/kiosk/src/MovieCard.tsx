import { gql, useQuery } from '@apollo/client';

const MOVIES = gql`
  query Movies {
    topRated {
      ... on Movie {
        director
        rating
      }
    }
  }
`;

export const MovieCard = () => {
  const { data } = useQuery(MOVIES);
  return <p>{data?.topRated.length} films</p>;
};
