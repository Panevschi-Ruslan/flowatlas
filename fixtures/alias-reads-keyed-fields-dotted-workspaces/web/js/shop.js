// The orders domain of the workspace eu.staging: two labels where the workspace is named.
const ORDERS = 'https://eu.staging.orders.shop.example.test/v1';

async function listOrders() {
  const answer = await fetch(`${ORDERS}/orders`);
  return answer.json();
}
