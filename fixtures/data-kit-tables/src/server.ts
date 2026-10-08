import express from 'express';
import { archive, lendBook, returnBook } from './loans';
import { joinLibrary, leaveLibrary, queueWelcome } from './members';
import { createClient } from '@acme/data-kit';
import { notifyHold, releaseHold, reservations } from './reservations';

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

app.post('/members', async (req, res) => {
  await joinLibrary(req.body.memberId, req.body.name);
  queueWelcome(req.body.memberId);
  res.status(201).end();
});

app.delete('/members/:memberId', async (req, res) => {
  await leaveLibrary(req.params.memberId);
  res.status(204).end();
});

app.post('/reservations/:isbn', async (req, res) => {
  await reservations.hold(req.params.isbn, req.body.memberId);
  notifyHold({ insert: () => undefined }, req.params.isbn);
  res.status(201).end();
});

app.delete('/reservations/:isbn', async (req, res) => {
  await releaseHold(createClient({ pool: 1 }), req.params.isbn);
  res.status(204).end();
});

app.listen(3000);
