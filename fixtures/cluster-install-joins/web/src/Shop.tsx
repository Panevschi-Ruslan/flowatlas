/** The shop, served by a way in with no host, calling whatever host it is served from. */
export const Shop = () => {
  const loadOrders = () => fetch('/orders');
  const loadProducts = () => fetch('/catalog/products');
  return (
    <section>
      <button onClick={loadOrders}>Orders</button>
      <button onClick={loadProducts}>Products</button>
    </section>
  );
};
