import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

import { reviewsOf, topProducts } from './reviews';

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@interfaceObject"])

  type Query {
    topProducts: [Product!]!
  }

  type Product @key(fields: "id") @interfaceObject {
    id: ID!
    reviews: [Review!]!
  }

  type Review {
    score: Int!
  }
`;

const resolvers = {
  Query: {
    topProducts: () => topProducts(),
  },
  Product: {
    __resolveReference: (reference: { id: string }) => ({ id: reference.id }),
    reviews: (product: { id: string }) => reviewsOf(product.id),
  },
};

const server = new ApolloServer({ schema: buildSubgraphSchema({ typeDefs, resolvers }) });

startStandaloneServer(server, { listen: { port: 4002 } });
