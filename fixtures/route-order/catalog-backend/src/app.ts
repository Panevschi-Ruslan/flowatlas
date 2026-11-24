import express from 'express';
import { itemExtrasRouter } from './item-extras.routes';
import { itemsRouter } from './items.routes';

export const app = express();

// Two routers under one prefix. Which is tried first is the order of these two
// lines, which the reader does not read: `GET /items/new` may be answered by
// the items router's `/:itemId`.
app.use('/items', itemsRouter);
app.use('/items', itemExtrasRouter);

app.listen(3002);
