export type Standing = 'good' | 'suspended';

export const handler = async (event: { borrowerId: string }): Promise<{ standing: Standing }> => ({
  standing: event.borrowerId === '' ? 'suspended' : 'good',
});
