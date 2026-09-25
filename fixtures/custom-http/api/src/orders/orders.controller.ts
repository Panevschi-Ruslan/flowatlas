import type { Handler } from 'minihttp';

/** Named handlers, so the graph has something to point at behind each route. */
export const listOrders: Handler = (req, res) => res.json([]);

export const createOrder: Handler = (req, res) => res.status(201).json({ id: '1' });

export const cancelOrder: Handler = (req, res) => res.json({ cancelled: true });
