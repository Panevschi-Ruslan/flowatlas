import express from 'express';
import { jobQueue } from './jobs/job-queue.js';
import { ReportsQueue } from './reports/reports.queue.js';

const app = express();
const reports = new ReportsQueue();

app.post('/orders/:orderId/receipt', async (req, res) => {
  await jobQueue.createJob({ type: 'send-receipt', payload: { orderId: req.params.orderId, email: 'a@b.c' } });
  res.status(202).end();
});

app.post('/images', async (req, res) => {
  await jobQueue.createJob({ type: 'make-thumbnail', payload: { imageUrl: String(req.body.url) } });
  res.status(202).end();
});

app.post('/stores/:storeId/report', async (req, res) => {
  await reports.request(req.params.storeId);
  res.status(202).end();
});

jobQueue.init();
reports.start();
app.listen(3000);
