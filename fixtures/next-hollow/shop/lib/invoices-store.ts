interface Invoice {
  id: string;
  total: number;
}

const invoices: Invoice[] = [{ id: 'in_1', total: 120 }];

/** The one thing in this repository a route handler reaches. */
export const listInvoices = async (): Promise<Invoice[]> => invoices;
