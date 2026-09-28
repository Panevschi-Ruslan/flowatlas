/**
 * What this repository believes the billing service takes and answers.
 *
 * Nobody here can check these against billing's own source, because there is no
 * billing source here to check them against: the only other statement of its
 * shapes is `contracts/billing.json`, and the contract check compares these two
 * declarations exactly as it compares two repositories' copies of one shape.
 */

/**
 * The body of `POST /invoices`, as this caller declares it.
 *
 * Three deliberate differences from the document, one per kind of finding:
 * `currency` is required there and absent here (`missing_required`), `note` is
 * required there and optional here (`optionality_mismatch`), and `traceId` is
 * here and nowhere in the document (`extra_field`).
 */
export interface CreateInvoiceDto {
  customerId: string;
  amount: number;
  note?: string;
  traceId: string;
}

/** What this caller expects back. `total` is text here and a number there. */
export interface InvoiceDto {
  id: string;
  total: string;
  issuedAt: string;
}

/** Copied verbatim out of the document, so this one pair cannot drift. */
export interface CustomerRefDto {
  id: string;
  name: string;
}
