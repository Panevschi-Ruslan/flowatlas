async function submit(basket) {
  const answer = await fetch(`${ORDERS_DOMAIN}/submit`, { method: 'POST', body: JSON.stringify(basket) });
  return answer.json();
}

async function submitDirect(basket) {
  const answer = await fetch(`${ORDERS_API}/submit`, { method: 'POST', body: JSON.stringify(basket) });
  return answer.json();
}

async function pay(orderId) {
  const answer = await fetch(`${PAYMENTS_API}/payments`, { method: 'POST', body: JSON.stringify({ orderId }) });
  return answer.json();
}

async function quoteRates() {
  const answer = await fetch(`${SHIPPING_API}/rates`);
  return answer.json();
}

async function listProducts() {
  const answer = await fetch(`${CATALOG_API}/products`);
  return answer.json();
}

async function listReviews() {
  const answer = await fetch(`${REVIEWS_API}/reviews`);
  return answer.json();
}
