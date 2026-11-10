/** A basket placed as an order on the shop's own API. */
export const handler = async (event: { basket: { id: string } }) => {
  const response = await fetch(`${process.env.SHOP_API}/orders`, {
    method: 'POST',
    body: JSON.stringify(event.basket),
  });
  return response.json();
};
