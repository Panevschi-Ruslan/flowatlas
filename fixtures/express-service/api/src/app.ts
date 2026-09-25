import express from 'express';
import { authenticate } from './middleware/authenticate';
import { ordersRouter } from './orders/orders.routes';
import publicRouter from './public/public.routes';

/**
 * The application, and the order everything is installed in.
 *
 * Order is the whole of what this fixture is about. `/public` is mounted above
 * `authenticate`, so nothing in front of it can refuse a request; `/orders` is
 * mounted below it, so every route the orders router declares is behind a
 * token, in a file that never mentions one.
 */
export const app = express();

// Mounted before anything is installed. Whatever this router declares is
// reached with nothing in front of it, which is what the route audit is asked
// about.
app.use('/public', publicRouter);

app.use(express.json());
app.use(authenticate);

app.use('/orders', ordersRouter);

app.listen(3000);
