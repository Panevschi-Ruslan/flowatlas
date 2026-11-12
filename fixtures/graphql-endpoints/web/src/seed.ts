const SHOP_NAME = 'Corner shop';

/** Posts a document to one of the server's schemas with the platform's fetch. */
const graphqlRequest = async (endpoint: string, query: string): Promise<unknown> => {
  const response = await fetch(`${import.meta.env.VITE_SERVER_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return response.json();
};

export const seedShop = async (): Promise<void> => {
  await graphqlRequest(
    '/settings',
    `mutation SeedShop {
      renameShop(name: "${SHOP_NAME}") {
        name
      }
    }`,
  );
};
