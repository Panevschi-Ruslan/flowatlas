import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

const stock = new Map<string, number>();

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key"])

  type Query {
    stock(id: ID!): Int
  }
`;

const resolvers = {
  Query: {
    stock: (_parent: unknown, args: { id: string }) => stock.get(args.id) ?? 0,
  },
};

startStandaloneServer(new ApolloServer({ schema: buildSubgraphSchema({ typeDefs, resolvers }) }), { listen: { port: 4004 } });
