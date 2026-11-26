import express from 'express';
import { CreateJob, jobQueue } from './jobs/job-queue.js';
import { buildArchiveJob, buildNotifyJob, buildThumbnailJobIfNeeded } from './jobs/job-records.js';
import { BullService } from './queues/bull.service.js';
import { InvoiceQueue, MailQueue, startWorkers } from './queues/queue-base.js';

const app = express();
const mail = new MailQueue();
const invoices = new InvoiceQueue(new BullService());

app.post('/signup', async (req, res) => {
  await mail.add({ name: 'welcome', data: { email: String(req.body.email) } });
  res.status(202).end();
});

app.post('/orders/:orderId/invoice', async (req, res) => {
  await invoices.add({ name: 'issue-invoice', data: { orderId: req.params.orderId } });
  res.status(202).end();
});

app.post('/orders/:orderId/archive', async (req, res) => {
  await jobQueue.createJob(await buildArchiveJob({ orderId: req.params.orderId, type: 'archive-order' }));
  res.status(202).end();
});

app.post('/orders/:orderId/restore', async (req, res) => {
  await jobQueue.createJob(await buildArchiveJob({ orderId: req.params.orderId, type: 'restore-order' }));
  res.status(202).end();
});

app.post('/images', async (req, res) => {
  await jobQueue.createJob(await buildThumbnailJobIfNeeded({ imageUrl: String(req.body.url), notify: true }));
  res.status(202).end();
});

app.post('/staff/notify', async (req, res) => {
  const job = { ...buildNotifyJob(String(req.body.target)), delay: 1000 };
  await jobQueue.createJob(job);
  res.status(202).end();
});

app.post('/partners/:partnerId/ping', async (req, res) => {
  const urgent = req.query.urgent === 'true';
  await jobQueue.createJob({ type: urgent ? 'ping-partner-parallel' : 'ping-partner', payload: { partnerId: req.params.partnerId } });
  res.status(202).end();
});

app.post('/reports/nightly', async (req, res) => {
  const parent: CreateJob = { type: 'nightly-report', payload: {} };
  const children: CreateJob[] = (req.body.orders ?? []).map((orderId: string) => ({ type: 'archive-order', payload: { orderId } }));
  await jobQueue.addAfterChildren(parent, children);
  res.status(202).end();
});

app.post('/months/:month/close', async (req, res) => {
  await jobQueue.closeMonth(req.params.month);
  res.status(202).end();
});

jobQueue.init();
startWorkers();
app.listen(3000);
