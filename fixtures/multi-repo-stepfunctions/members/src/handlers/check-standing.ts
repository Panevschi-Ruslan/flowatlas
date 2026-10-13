interface StandingRequest {
  borrowerId: string;
}

const lookUpStanding = async (borrowerId: string): Promise<'good' | 'suspended'> =>
  borrowerId.startsWith('suspended-') ? 'suspended' : 'good';

export const handler = async (event: StandingRequest): Promise<{ standing: 'good' | 'suspended' }> => ({
  standing: await lookUpStanding(event.borrowerId),
});
