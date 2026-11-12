import { FlowProducer, Job, Queue, Worker } from 'bullmq';

export type JobType =
  | 'archive-order'
  | 'restore-order'
  | 'make-thumbnail'
  | 'notify-staff'
  | 'ping-partner'
  | 'ping-partner-parallel'
  | 'nightly-report'
  | 'close-month';

export type CreateJob = { type: JobType; payload: Record<string, unknown> };

async function archiveOrder(job: Job<{ orderId: string }>): Promise<void> {
  console.log('archive', job.data.orderId);
}

async function makeThumbnail(job: Job<{ imageUrl: string }>): Promise<void> {
  console.log('thumbnail', job.data.imageUrl);
}

async function notifyStaff(job: Job<{ target: string }>): Promise<void> {
  console.log('notify', job.data.target);
}

async function pingPartner(job: Job<{ partnerId: string }>): Promise<void> {
  console.log('ping', job.data.partnerId);
}

async function runReport(job: Job): Promise<void> {
  console.log('report', job.id);
}

/** One handler per kind of job; each kind is a queue of its own. */
const processors: { [type in JobType]: (job: Job) => Promise<void> } = {
  'archive-order': archiveOrder,
  'restore-order': archiveOrder,
  'make-thumbnail': makeThumbnail,
  'notify-staff': notifyStaff,
  'ping-partner': pingPartner,
  'ping-partner-parallel': pingPartner,
  'nightly-report': runReport,
  'close-month': runReport,
};

class JobQueue {
  private queues: { [type in JobType]?: Queue } = {};
  private flows: FlowProducer;

  init(): void {
    for (const type of Object.keys(processors)) {
      this.queues[type] = new Queue(type);
      new Worker(type, (job: Job) => processors[type](job));
    }
    this.flows = new FlowProducer({ connection: {} });
    // A job the queue adds on a schedule, through the registry's own entry.
    this.queues['nightly-report'].upsertJobScheduler('nightly-report', { every: 86_400_000 }, { data: {} });
  }

  createJob(options: CreateJob | undefined) {
    if (!options) return;
    const queue: Queue = this.queues[options.type];
    return queue.add('job', options.payload);
  }

  /** A parent job run after its children, each on its own queue. */
  addAfterChildren(parent: CreateJob, children: CreateJob[]) {
    return this.flows.add({
      ...this.flowJob(parent),
      children: children.map((child) => this.flowJob(child)),
    });
  }

  /** A flow written out where it is added. */
  closeMonth(month: string) {
    return this.flows.add({
      name: 'close',
      queueName: 'close-month',
      data: { month },
      children: [{ name: 'archive', queueName: 'archive-order', data: { month } }],
    });
  }

  private flowJob(job: CreateJob) {
    return { name: 'job', queueName: job.type, data: job.payload };
  }
}

export const jobQueue = new JobQueue();
