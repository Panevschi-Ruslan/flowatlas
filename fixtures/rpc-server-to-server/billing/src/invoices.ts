const invoices = new Map<string, { id: string; orderId: string; refunded: boolean }>();

export const invoiceFor = (orderId: string) => {
  const id = `i-${invoices.size + 1}`;
  invoices.set(id, { id, orderId, refunded: false });
  return { id };
};

export const invoicesOf = (orderId: string) => [...invoices.values()].filter((invoice) => invoice.orderId === orderId);

export const refund = (invoiceId: string) => {
  const invoice = invoices.get(invoiceId);
  if (invoice !== undefined) invoice.refunded = true;
  return { refunded: invoice !== undefined };
};
