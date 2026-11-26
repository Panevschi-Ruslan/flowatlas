import express from 'express';
import { CreateJob, jobQueue } from './jobs/job-queue.js';
import { buildNotifyJobs, buildPublishJob, buildRetryJob } from './jobs/job-records.js';
import { BullClient } from './queues/bull-client.js';
import { InvoiceQueue, MailQueue } from './queues/queue-base.js';
import { startWorkers } from './queues/worker-base.js';

const app = express();
const mail = new MailQueue(new BullClient());
const invoices = new InvoiceQueue(new BullClient());

app.post('/signup', async (req, res) => {
  await mail.add({ name: 'welcome', data: { email: String(req.body.email) } });
  res.status(202).end();
});

app.post('/orders/:orderId/invoice', async (req, res) => {
  await invoices.add({ name: 'issue-invoice', data: { orderId: req.params.orderId } });
  res.status(202).end();
});

app.post('/images/:imageId', async (req, res) => {
  await jobQueue.createSequentialJobFlow(
    { type: 'resize-image', payload: { imageId: req.params.imageId } },
    buildPublishJob(req.params.imageId),
    undefined,
  );
  res.status(202).end();
});

app.post('/items/:itemId/publish', async (req, res) => {
  const jobs: CreateJob[] = [{ type: 'archive-order', payload: { itemId: req.params.itemId } }];
  jobs.push(buildPublishJob(req.params.itemId));
  if (req.query.notify === 'true') jobs.push(...buildNotifyJobs(req.params.itemId));
  jobs.push(req.body.followUp as CreateJob);
  await jobQueue.createSequentialJobFlow(...jobs);
  res.status(202).end();
});

app.post('/months/:month/close', async (req, res) => {
  const children: CreateJob[] = [];
  for (const orderId of (req.body.orders ?? []) as string[]) {
    children.push({ type: 'archive-order', payload: { orderId } });
  }
  if (req.body.importId) children.push(await buildRetryJob(String(req.body.importId)));
  await jobQueue.createJobWithChildren({ type: 'close-month', payload: { month: req.params.month } }, children);
  res.status(202).end();
});

jobQueue.init();
startWorkers();
app.listen(3000);
