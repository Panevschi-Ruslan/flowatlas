// The staging workspace's orders domain, and the catalogue's in production.
const ORDERS = 'https://staging.orders.shop.example.test/v1';
const CATALOG = 'https://catalog.shop.example.test';

async function listOrders() {
  const answer = await fetch(`${ORDERS}/orders`);
  return answer.json();
}

async function listProducts() {
  const answer = await fetch(`${CATALOG}/products`);
  return answer.json();
}
