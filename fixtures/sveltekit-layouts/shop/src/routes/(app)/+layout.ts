import { listMenu } from '$lib/api';

export const load = async (): Promise<{ menu: unknown }> => ({ menu: await listMenu() });
