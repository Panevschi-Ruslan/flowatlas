interface LoanCheckedOut {
  source: string;
  'detail-type': string;
  detail: { titleId: string; copyId: string };
}

const copiesLeft = async (titleId: string): Promise<number> => (titleId.endsWith('-rare') ? 0 : 1);

/** Runs on every LoanCheckedOut the checkout workflow puts on the library bus. */
export const handler = async (event: LoanCheckedOut): Promise<{ available: boolean }> => ({
  available: (await copiesLeft(event.detail.titleId)) > 0,
});
