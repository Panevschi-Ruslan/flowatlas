const sent: Array<{ borrowerId: string; subject: string }> = [];

export const deliver = async (borrowerId: string, subject: string): Promise<void> => {
  sent.push({ borrowerId, subject });
};
