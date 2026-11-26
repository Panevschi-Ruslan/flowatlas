import { ApolloServer } from 'apollo-server-lambda';
import { resolvers } from './resolvers';
import { typeDefs } from './type-defs';

/**
 * The function's handler is the server itself, made into a function by the
 * library: nothing here names a function of this repository, and every field
 * the resolver map answers is a way in that runs through it.
 */
export const server = new ApolloServer({ resolvers, typeDefs }).createHandler();
