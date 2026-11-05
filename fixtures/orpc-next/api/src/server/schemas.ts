import { z } from 'zod';

export const OrderQuery = z.object({ status: z.enum(['open', 'shipped']).optional() });

export const OrderId = z.object({ id: z.string() });

export const NewOrder = z.object({ sku: z.string(), quantity: z.number() });

export const Order = z.object({ id: z.string(), sku: z.string(), quantity: z.number() });

export const Orders = z.array(Order);
