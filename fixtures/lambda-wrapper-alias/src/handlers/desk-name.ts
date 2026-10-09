import * as tracing from '../lib/tracing';

const findDesk = async (id: string): Promise<string | undefined> => (id === 'desk' ? 'Main desk' : undefined);

// A factory reached by another name is still a factory: what it builds is its
// own handler, and `findDesk` is not it.
const listOf = tracing.listing;

export const handler = listOf(findDesk);
