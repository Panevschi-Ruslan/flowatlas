import express from 'express';
import { archive, lendBook, returnBook } from './loans';

const app = express();
app.use(express.json());

app.post('/loans', async (req, res) => {
  res.status(201).json(await lendBook(req.body.memberId, req.body.isbn));
});

app.delete('/loans/:loanId', async (req, res) => {
  await returnBook(req.params.loanId);
  res.status(204).end();
});

app.post('/loans/archive/:year', async (req, res) => {
  await archive(Number(req.params.year), req.body);
  res.status(204).end();
});

app.listen(3000);
