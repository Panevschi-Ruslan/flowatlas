import express from 'express';
import { holdsRouter } from './holds/holds.routes';
import { loansRouter } from './loans/loans.routes';
import { returnsRouter } from './returns/returns.routes';

/**
 * A lending library's API: plain Express handlers that record something and
 * then tell the rest of the library about it, through EventBridge and SQS.
 */
export const app = express();

app.use(express.json());
app.use('/loans', loansRouter);
app.use('/holds', holdsRouter);
app.use('/returns', returnsRouter);

app.listen(3000);
