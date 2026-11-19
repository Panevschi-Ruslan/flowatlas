/** The shop, calling its own dev server, which forwards each prefix on. */
export const Shop = () => {
  const loadOrder = () => fetch('/api/orders/7');
  const loadLegacy = () => fetch('/legacy/products');
  const loadProduct = () => fetch('/v2/catalog/products/1');
  const loadLoop = () => fetch('/loop/ping');
  return (
    <section>
      <button onClick={loadOrder}>Order</button>
      <button onClick={loadLegacy}>Legacy</button>
      <button onClick={loadProduct}>Product</button>
      <button onClick={loadLoop}>Loop</button>
    </section>
  );
};
