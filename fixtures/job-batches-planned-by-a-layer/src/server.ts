import { Queue, Worker } from 'bullmq';
import express from 'express';
import { BullClient } from './queues/bull-client.js';
import { InvoiceQueue, MailQueue } from './queues/queue-base.js';
import { InvoiceWorker, MailWorker } from './queues/worker-base.js';

const app = express();
const mail = new MailQueue(new BullClient());
const invoices = new InvoiceQueue(new BullClient());
const maintenance = new Queue('maintenance', { connection: {} });

app.post('/signup', async (req, res) => {
  await mail.add({ name: 'welcome', data: { email: String(req.body.email) } });
  res.status(202).end();
});

app.post('/orders/:orderId/invoices', async (req, res) => {
  const data = { orderId: req.params.orderId };
  await invoices.addBulk([
    { name: 'issue-invoice', data },
    { name: 'remind-invoice', data, delay: 7 * 24 * 60 * 60 * 1000 },
  ]);
  res.status(202).end();
});

// A scheduler's template names its job, or leaves the job named by the
// scheduler's id; one handed no template at all does the same.
const scheduleMaintenance = async (): Promise<void> => {
  await maintenance.upsertJobScheduler('prune-baskets', { every: 60 * 60 * 1000 }, { data: { olderThanDays: 30 } });
  await maintenance.upsertJobScheduler('nightly', { pattern: '0 3 * * *' }, { name: 'rebuild-search', data: {} });
  await maintenance.upsertJobScheduler('expire-coupons', { every: 24 * 60 * 60 * 1000 });
};

new Worker('maintenance', async (job) => console.log('maintenance', job.name), { connection: {} });
new MailWorker(new BullClient());
new InvoiceWorker(new BullClient());
void scheduleMaintenance();
app.listen(3000);
