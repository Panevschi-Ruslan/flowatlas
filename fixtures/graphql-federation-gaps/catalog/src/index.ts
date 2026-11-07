import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { parse } from 'graphql';

import { allBooks, bookById, detailsOf } from './books';

// Product is an entity interface, and nothing here says which of its types an
// entity call for one is: no Product.__resolveReference, no __resolveType.
const resolvers = {
  Query: {
    book: (_: unknown, args: { id: string }) => bookById(args.id),
    products: () => allBooks(),
  },
  Book: {
    details: (book: { id: string }) => detailsOf(book.id),
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs: parse(readFileSync(join(__dirname, 'schema.graphql'), 'utf8')), resolvers }),
});

startStandaloneServer(server, { listen: { port: 4001 } });
