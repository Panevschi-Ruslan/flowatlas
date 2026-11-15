async function listProducts() {
  const answer = await fetch(`${CATALOG_API}/products`);
  return answer.json();
}

async function pay(orderId) {
  const answer = await fetch(`${PAYMENTS_API}/payments`, { method: 'POST', body: JSON.stringify({ orderId }) });
  return answer.json();
}

async function listReceipts() {
  const answer = await fetch(`${RECEIPTS_API}/receipts`);
  return answer.json();
}
