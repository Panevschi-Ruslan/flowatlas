/** Builds a member's weekly digest; the loans service decides where its results go. */
export const handler = async (event: { memberId: string }): Promise<{ memberId: string }> => ({ memberId: event.memberId });
