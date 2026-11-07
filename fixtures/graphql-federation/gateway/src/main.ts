import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApolloGateway } from '@apollo/gateway';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import express from 'express';

// The supergraph is composed from the subgraphs by rover and committed beside the gateway.
const gateway = new ApolloGateway({ supergraphSdl: readFileSync(join(__dirname, '..', 'supergraph.graphql'), 'utf8') });
const server = new ApolloServer({ gateway });

const start = async (): Promise<void> => {
  await server.start();
  const app = express();
  app.use(express.json());
  app.use('/graphql', expressMiddleware(server));
  app.listen(4000);
};

void start();
