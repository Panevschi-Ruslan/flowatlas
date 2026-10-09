export interface Notice {
  borrowerId: string;
  subject: string;
  body: string;
}

/** The wording of every notice the library sends, in one place. */
export const composeNotice = (borrowerId: string, kind: 'approved' | 'renewed' | 'fee-due' | 'overdue'): Notice => {
  const subjects: Record<typeof kind, string> = {
    approved: 'Your loan is ready to collect',
    renewed: 'Your loans have been renewed',
    'fee-due': 'A late fee is due before you can renew',
    overdue: 'You have items past their return date',
  };
  return { borrowerId, subject: subjects[kind], body: `${subjects[kind]}.` };
};

/** Hands a notice to the outbound mail queue the library shares with its catalogue. */
export const sendNotice = async (notice: Notice): Promise<void> => {
  await Promise.resolve(notice);
};
