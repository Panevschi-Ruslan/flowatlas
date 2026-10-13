import express from 'express';
import { ordersRouter } from './orders.routes';

const app = express();

app.use(express.json());
app.use('/orders', ordersRouter);

app.listen(3000);
