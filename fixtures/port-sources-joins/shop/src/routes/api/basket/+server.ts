import { json } from '@sveltejs/kit';

/** The basket, served by the shop's own server. */
export const GET = async () => json({ items: [] });
