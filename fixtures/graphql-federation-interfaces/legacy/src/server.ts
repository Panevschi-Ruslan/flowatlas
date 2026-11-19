import { createServer } from 'node:http';
import { createSchema, createYoga } from 'graphql-yoga';

// The service inventory replaced, still started on the port inventory took over.
const yoga = createYoga({
  schema: createSchema({
    typeDefs: /* GraphQL */ `
      type Query {
        stock(id: ID!): Int
      }
    `,
    resolvers: {
      Query: {
        stock: () => 0,
      },
    },
  }),
});

createServer(yoga).listen(4004);
