import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { parse } from 'graphql';

import { allMedia, directorOf, mediaById } from './catalog';

const resolvers = {
  Query: {
    media: () => allMedia(),
  },
  Media: {
    // An entity interface's reference resolver answers with the type the item is (__typename).
    __resolveReference: (reference: { id: string }) => mediaById(reference.id),
  },
  Movie: {
    director: (movie: { id: string }) => directorOf(movie.id),
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs: parse(readFileSync(join(__dirname, 'schema.graphql'), 'utf8')), resolvers }),
});

startStandaloneServer(server, { listen: { port: 4001 } });
