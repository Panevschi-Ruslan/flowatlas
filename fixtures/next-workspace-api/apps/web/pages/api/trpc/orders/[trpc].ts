import { createNextApiHandler } from '@shop/api/createNextApiHandler';
import { ordersRouter } from '@shop/api/routers/orders/_router';

export default createNextApiHandler(ordersRouter);
