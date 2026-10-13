import express from 'express';
import { requestLoan } from './loans/request-loan';

/**
 * The circulation desk's API: one route, where a borrower asks for a loan.
 *
 * What happens to the request afterwards is not in this code at all. It is the
 * state machine in `statemachine/loan-approval.asl.json`, which is why this
 * repository is in the fixture: the server reader opens it for its routes, and
 * reads the definition beside them.
 */
export const app = express();

app.use(express.json());
app.post('/loans', requestLoan);

app.listen(3000);
