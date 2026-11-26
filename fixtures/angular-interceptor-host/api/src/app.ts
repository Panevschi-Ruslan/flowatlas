import express from 'express';
import { catalogRouter } from './catalog.routes';

export const app = express();

app.use(express.json());
app.use('/api', catalogRouter);

app.listen(3000);
