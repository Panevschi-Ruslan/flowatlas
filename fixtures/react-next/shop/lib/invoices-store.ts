interface InvoiceRecord {
  id: string;
  total: number;
}

const invoices = new Map<string, InvoiceRecord>();

export const listInvoices = async (): Promise<InvoiceRecord[]> => [...invoices.values()];
