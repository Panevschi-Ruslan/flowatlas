import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

// Both fields need the weight. `estimate` asks read:weight and read:estimate
// together, which lets through only tokens the weight lets through; `fragile`
// asks read:fragile alone, so the router fetches the weight for it unchecked.
const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@external", "@requires", "@requiresScopes"])

  type Product @key(fields: "id") {
    id: ID!
    weight: Int! @external
    estimate: Int! @requires(fields: "weight") @requiresScopes(scopes: [["read:weight", "read:estimate"]])
    fragile: Boolean! @requires(fields: "weight") @requiresScopes(scopes: [["read:fragile"]])
  }
`;

const resolvers = {
  Product: {
    __resolveReference: (reference: { id: string; weight?: number }) => reference,
    estimate: (product: { weight: number }) => product.weight * 3,
    fragile: (product: { weight: number }) => product.weight < 1,
  },
};

const server = new ApolloServer({ schema: buildSubgraphSchema({ typeDefs, resolvers }) });

startStandaloneServer(server, { listen: { port: 4003 } });
