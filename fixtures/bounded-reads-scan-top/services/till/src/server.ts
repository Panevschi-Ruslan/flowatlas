import express from 'express';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { toMinor, type Money } from '@books/money';

// The contract at the top of the project, named by its bare file name.
const books = loadPackageDefinition(loadSync('ledger.proto')) as any;
const ledger = new books.books.LedgerService(process.env.LEDGER_ADDR, credentials.createInsecure());

const app = express();
app.use(express.json());

app.post('/sales', (req, res) => {
  const price: Money = req.body.price;
  ledger.record({ account: req.body.account, amount: toMinor(price) }, (error: Error | null, reply: unknown) =>
    error ? res.sendStatus(502) : res.json(reply),
  );
});

app.get('/balance/:account', (req, res) => {
  ledger.balance({ account: req.params.account }, (error: Error | null, reply: unknown) =>
    error ? res.sendStatus(502) : res.json(reply),
  );
});

app.listen(8080);
