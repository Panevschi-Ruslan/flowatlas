import express from 'express';
import { Notifier } from './notifier.js';
import { ReceiptWorker, startRefunds } from './workers.js';

const app = express();
const notifier = new Notifier();

app.post('/orders/:orderId/notify', async (req, res) => {
  await notifier.notify(String(req.body.kind), { orderId: req.params.orderId });
  res.status(202).end();
});

app.post('/orders/:orderId/pushed', async (req, res) => {
  await notifier.pushed({ orderId: req.params.orderId });
  res.status(202).end();
});

app.post('/orders/:orderId/remind', async (req, res) => {
  await notifier.remind('remind-payment', { orderId: req.params.orderId });
  res.status(202).end();
});

new ReceiptWorker();
startRefunds();
app.listen(3000);
