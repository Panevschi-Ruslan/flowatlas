import { loadOrder } from '$lib/api';

export const load = async ({ params }: { params: { id: string } }): Promise<{ order: unknown }> => ({ order: await loadOrder(params.id) });
