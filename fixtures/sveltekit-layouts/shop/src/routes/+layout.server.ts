import { readSession } from '$lib/api';

export const load = async (): Promise<{ session: unknown }> => ({ session: await readSession() });
