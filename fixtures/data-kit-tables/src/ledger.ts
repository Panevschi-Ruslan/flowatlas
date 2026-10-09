// A client of the repository's own: the factory says what it returns, and a
// service handed one is typed by that interface alone, with no `clientType` on
// the row. The two are compared by what the factory resolves to return (P49).
export interface Ledger {
  record(table: string, row: object): Promise<void>;
}

export const openLedger = (): Ledger => ({
  record: async () => undefined,
});

export const recordFine = async (ledger: Ledger, memberId: string, amount: number): Promise<void> => {
  await ledger.record('fines', { memberId, amount });
};
