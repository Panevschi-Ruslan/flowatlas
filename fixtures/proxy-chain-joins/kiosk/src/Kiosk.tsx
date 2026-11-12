/** The kiosk, asking for an order through the shop's dev server. */
export const Kiosk = () => {
  const loadOrder = () => fetch('/shop/api/orders/7');
  return <button onClick={loadOrder}>Order</button>;
};
