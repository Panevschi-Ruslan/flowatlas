export default defineEventHandler((event) => {
  const query = getQuery(event);
  return allProducts().filter((product) => product.includes(String(query.q ?? '')));
});
