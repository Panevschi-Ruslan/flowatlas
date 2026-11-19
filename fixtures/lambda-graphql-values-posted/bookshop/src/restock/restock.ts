import fetch from 'node-fetch';

const CATALOG = `${process.env.CATALOG_API_URL}/catalog`;

/**
 * A scheduled function that talks to the catalog by posting GraphQL
 * operations with node-fetch, each written with its values in it.
 */
export const handler = async (title: string, copies: number, bookId: string, fields: string, plugin: string, suffix: string, area: string): Promise<void> => {
  // The body is held in a const, a value is written inside a string and
  // another bare where an argument's value goes.
  const body = {
    query: `mutation {
      addBook(title: "${title}", copies: ${copies}) {
        id
      }
    }`,
  };
  await fetch(CATALOG, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // One line, its line breaks written as escapes.
  await fetch(CATALOG, {
    method: 'POST',
    body: JSON.stringify({ query: `query {\n  book(id: ${bookId}) {\n    title\n  }\n}` }),
  });

  // The fields it selects are built at run time: a request to the endpoint, its fields unread.
  await fetch(CATALOG, {
    method: 'POST',
    body: JSON.stringify({ query: `query { books { ${fields} } }` }),
  });

  // Part of the address is built at run time, under a route of one segment it may or may not fit.
  await fetch(`${process.env.CATALOG_API_URL}/plugins/${plugin}/install${suffix}`);

  // Part of the address is built at run time, and nothing answers whatever it holds.
  await fetch(`${process.env.CATALOG_API_URL}/reports/${area}-summary`);
};
