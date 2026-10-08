const pending: Array<{ event: string; subject: string }> = [];

// A helper of the repository's own whose writes leave through a batch nobody
// can follow here. The configuration names it and the one table it always
// writes, with no argument to read the table from.
export const auditLog = async (event: string, subject: string): Promise<void> => {
  pending.push({ event, subject });
};
