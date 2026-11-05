import { gql, useQuery } from '@apollo/client';

const buildQuery = (fields: string[]): string => `query { orders { ${fields.join(' ')} } }`;

export const Search = ({ fields }: { fields: string[] }) => {
  const { data } = useQuery(gql(buildQuery(fields)));
  return <pre>{JSON.stringify(data)}</pre>;
};
