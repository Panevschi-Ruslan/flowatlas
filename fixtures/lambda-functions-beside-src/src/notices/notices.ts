const sent: string[] = [];

/** The notice a borrower gets when a title held for them was not collected in time. */
export const tellBorrowerHoldLapsed = async (borrowerId: string, isbn: string): Promise<void> => {
  sent.push(`${borrowerId}: your hold on ${isbn} has lapsed`);
};
