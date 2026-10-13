import { json, type RequestHandler } from '@sveltejs/kit';
import { listOrders } from '../../../lib/orders.js';

export const GET: RequestHandler = async () => json(await listOrders());
