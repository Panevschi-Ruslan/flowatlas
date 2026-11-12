import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { buildSubgraphSchema } from '@apollo/subgraph';
import express from 'express';
import gql from 'graphql-tag';

import { ratingOf, reviewsOf, topRated } from './reviews';

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@interfaceObject", "@authenticated"])

  type Query {
    topRated: [Media!]!
  }

  type Media @key(fields: "id") @interfaceObject {
    id: ID!
    reviews: [Review!]!
    rating: Float @authenticated
  }

  type Review {
    score: Int!
    body: String!
  }
`;

const resolvers = {
  Query: {
    topRated: () => topRated(),
  },
  Media: {
    __resolveReference: (reference: { id: string }) => ({ id: reference.id }),
    reviews: (media: { id: string }) => reviewsOf(media.id),
    rating: (media: { id: string }) => ratingOf(media.id),
  },
};

const server = new ApolloServer({ schema: buildSubgraphSchema({ typeDefs, resolvers }) });

const main = async (): Promise<void> => {
  await server.start();
  const app = express();
  app.use('/graphql', expressMiddleware(server));
  app.listen(4002);
};

main();
