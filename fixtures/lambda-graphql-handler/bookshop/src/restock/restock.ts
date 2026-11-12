/**
 * A scheduled function that asks the catalog for a book by sending it a
 * GraphQL operation: the request joins the catalog's route, and the field it
 * selects joins the resolver behind it.
 */
const ADD_BOOK = `
  mutation AddBook($title: String!) {
    addBook(title: $title) {
      id
    }
  }
`;

export const handler = async (): Promise<void> => {
  await fetch(`${process.env.CATALOG_API_URL}/catalog`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: ADD_BOOK, variables: { title: 'Dune' } }),
  });
};
