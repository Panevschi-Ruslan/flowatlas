import express from 'express';

import { loansRouter } from './routes/loans';

const app = express();

app.use('/loans', loansRouter);

app.listen(9102);
