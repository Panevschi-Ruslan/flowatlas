import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

import { listOrders, ordersOf } from './orders';

// Federation 1: the customer is another subgraph's entity, extended here.
const typeDefs = gql`
  type Query {
    orders: [Order!]!
    status: String!
  }

  type Order @key(fields: "id") {
    id: ID!
    total: Float!
    customer: Customer!
  }

  extend type Customer @key(fields: "id") {
    id: ID! @external
    orders: [Order!]!
  }
`;

const resolvers = {
  Query: {
    orders: () => listOrders(),
    status: () => 'ok',
  },
  Order: {
    customer: (order: { customerId: string }) => ({ __typename: 'Customer', id: order.customerId }),
  },
  Customer: {
    orders: (customer: { id: string }) => ordersOf(customer.id),
  },
};

const server = new ApolloServer({ schema: buildSubgraphSchema([{ typeDefs, resolvers }]) });

void startStandaloneServer(server, { listen: { port: 4001 } });
