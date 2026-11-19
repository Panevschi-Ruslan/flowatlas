import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

// A product's weight is for a token with read:weight, or for staff: the
// router checks @requiresScopes on a client's selection of it.
const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@requiresScopes"])

  type Product @key(fields: "id") {
    id: ID!
    weight: Int! @requiresScopes(scopes: [["read:weight"], ["staff"]])
  }
`;

const resolvers = {
  Product: {
    __resolveReference: (reference: { id: string }) => ({ id: reference.id }),
    weight: () => 2,
  },
};

const server = new ApolloServer({ schema: buildSubgraphSchema({ typeDefs, resolvers }) });

startStandaloneServer(server, { listen: { port: 4002 } });
