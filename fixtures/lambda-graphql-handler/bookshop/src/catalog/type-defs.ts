import { gql } from 'apollo-server-lambda';

export const typeDefs = gql`
  type Book {
    id: ID!
    title: String!
  }

  type Author {
    id: ID!
    name: String!
  }

  type Query {
    book(id: ID!): Book
    books: [Book!]!
    author(id: ID!): Author
  }

  type Mutation {
    addBook(title: String!): Book!
  }
`;
