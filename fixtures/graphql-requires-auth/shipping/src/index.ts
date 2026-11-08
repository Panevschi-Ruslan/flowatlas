import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

// Both fields need the weight. `fragile` asks what the weight asks; `estimate`
// does not, so the router fetches the weight for it unchecked.
const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@external", "@requires", "@authenticated"])

  type Product @key(fields: "id") {
    id: ID!
    weight: Int! @external
    estimate: Int! @requires(fields: "weight")
    fragile: Boolean! @requires(fields: "weight") @authenticated
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
