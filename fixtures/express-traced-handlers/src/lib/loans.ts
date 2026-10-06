/** What the handlers reach, so a body that was read has somewhere to go. */
export const findLoan = async (id: string): Promise<{ id: string }> => ({ id });

export const listLoansFor = async (borrowerId: string): Promise<Array<{ id: string }>> => [{ id: borrowerId }];

export const saveLoan = async (isbn: string): Promise<{ id: string }> => ({ id: isbn });

export const closeLoan = async (id: string): Promise<{ id: string }> => ({ id });

export const holdsFromCache = async (): Promise<string[] | undefined> => undefined;

export const holdsFromTable = async (): Promise<string[]> => [];
