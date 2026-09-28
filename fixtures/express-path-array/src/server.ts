import express from 'express';

import { itemsRouter } from './items.routes';

/** An ordinary application; everything this fixture is about is on the router. */
const app = express();

app.use('/api', itemsRouter);

app.listen(9100);
