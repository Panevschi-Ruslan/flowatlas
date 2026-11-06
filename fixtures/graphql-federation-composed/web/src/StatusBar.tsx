import { gql, useQuery } from '@apollo/client';

const STATUS = gql`
  query Status {
    status
  }
`;

export const StatusBar = () => {
  const { data } = useQuery(STATUS);
  return <footer>{data?.status}</footer>;
};
