import { listInvoices } from '../api/orders';

/**
 * A screen whose request is written in a wrapper one call away.
 *
 * `listInvoices` hands the tail of the address to `send`, and `send` writes the
 * root. Neither of them is a readable address on its own; together they are
 * `/api/invoices`, and it is read at the one call that decides it.
 */
export function InvoicesPanel() {
  return (
    <section>
      <button type="button" onClick={() => listInvoices()}>
        Load invoices
      </button>
    </section>
  );
}
