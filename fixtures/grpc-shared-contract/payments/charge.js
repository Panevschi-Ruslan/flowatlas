const ledger = [];

async function charge(request) {
  const transactionId = `tx-${ledger.length + 1}`;
  ledger.push({ transactionId, orderId: request.orderId, amount: request.amount });
  return { transactionId };
}

module.exports = { charge };
