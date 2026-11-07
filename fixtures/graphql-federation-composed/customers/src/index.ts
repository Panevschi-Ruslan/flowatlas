import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { parse } from 'graphql';

import { customerById } from './customers';

const resolvers = {
  Query: {
    customer: (_parent: unknown, args: { id: string }) => customerById(args.id),
    status: () => 'ok',
  },
  Customer: {
    __resolveReference: (reference: { id: string }) => customerById(reference.id),
  },
};

export const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs: parse(readFileSync(join(__dirname, 'schema.graphql'), 'utf8')), resolvers }),
});

export const mount = (app: { use(path: string, handler: unknown): void }): void => {
  app.use('/graphql', expressMiddleware(server));
};
