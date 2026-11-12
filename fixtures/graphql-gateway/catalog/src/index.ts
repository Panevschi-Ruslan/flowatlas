import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';

import { resolvers } from './resolvers';

const server = new ApolloServer({ typeDefs: readFileSync(join(__dirname, 'schema.graphql'), 'utf8'), resolvers });

void startStandaloneServer(server, { listen: { port: 4001 } });
