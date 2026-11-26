import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])

  type Query {
    product(id: ID!): Product
  }

  type Product @key(fields: "id") {
    id: ID!
    name: String!
  }
`;

const resolvers = {
  Query: {
    product: (_: unknown, args: { id: string }) => ({ id: args.id, name: 'Green tea' }),
  },
  Product: {
    __resolveReference: (reference: { id: string }) => ({ id: reference.id, name: 'Green tea' }),
  },
};

const server = new ApolloServer({ schema: buildSubgraphSchema({ typeDefs, resolvers }) });

startStandaloneServer(server, { listen: { port: 4001 } });
