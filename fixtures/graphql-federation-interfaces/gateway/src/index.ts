import { ApolloGateway, IntrospectAndCompose } from '@apollo/gateway';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import express from 'express';

// Each subgraph at the port its own server listens on; inventory by its host.
const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: 'media', url: 'http://localhost:4001/graphql' },
      { name: 'reviews', url: 'http://localhost:4002/graphql' },
      { name: 'accounts', url: 'http://localhost:4003/graphql' },
      { name: 'inventory', url: 'http://inventory:4004/graphql' },
    ],
  }),
});

const server = new ApolloServer({ gateway });

const main = async (): Promise<void> => {
  await server.start();
  const app = express();
  app.use('/graphql', expressMiddleware(server));
  app.listen(4000);
};

main();
