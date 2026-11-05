import { z } from 'zod';

import { saveOrder } from '../utils/orders';

const newOrder = z.object({ name: z.string().min(1) });

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, newOrder.parse);
  if (body.name === 'forbidden') {
    throw createError({ statusCode: 422, statusMessage: 'that name is taken' });
  }
  return saveOrder(body.name);
});
