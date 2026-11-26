import { gql, useQuery } from '@apollo/client';

const TOP = gql`
  query Top {
    topRated {
      rating
      title
      ... on Book {
        author
      }
    }
  }
`;

export const TopRated = () => {
  const { data } = useQuery(TOP);
  return <ol>{data?.topRated.map((item: { title: string }) => <li key={item.title}>{item.title}</li>)}</ol>;
};
