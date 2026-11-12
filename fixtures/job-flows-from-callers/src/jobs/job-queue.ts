import { FlowJob, FlowProducer, Job, Worker } from 'bullmq';

export type JobType = 'resize-image' | 'publish-item' | 'notify-staff' | 'archive-order' | 'close-month' | 'retry-import';

export type CreateJob = { type: JobType; payload: Record<string, unknown> };

async function runJob(job: Job): Promise<void> {
  console.log('run', job.name, job.id);
}

/** One handler per kind of job; each kind is a queue of its own. */
const processors: { [type in JobType]: (job: Job) => Promise<void> } = {
  'resize-image': runJob,
  'publish-item': runJob,
  'notify-staff': runJob,
  'archive-order': runJob,
  'close-month': runJob,
  'retry-import': runJob,
};

class JobQueue {
  private flows: FlowProducer;

  init(): void {
    for (const type of Object.keys(processors)) {
      new Worker(type, (job: Job) => processors[type](job));
    }
    this.flows = new FlowProducer({ connection: {} });
  }

  /**
   * Jobs run one after the other: each job built is the parent of the one
   * built before it, so the last one handed in runs last.
   */
  createSequentialJobFlow(...jobs: (CreateJob | undefined)[]) {
    let lastJob: FlowJob;

    for (const job of jobs) {
      if (!job) continue;

      lastJob = {
        ...this.buildFlowJob(job),
        children: lastJob ? [lastJob] : [],
      };
    }

    return this.flows.add(lastJob);
  }

  /** A parent job run after its children, each on its own queue. */
  createJobWithChildren(parent: CreateJob, children: CreateJob[]) {
    return this.flows.add({
      ...this.buildFlowJob(parent),
      children: children.map((child) => this.buildFlowJob(child)),
    });
  }

  private buildFlowJob(job: CreateJob): FlowJob {
    return { name: 'job', queueName: job.type, data: job.payload };
  }
}

export const jobQueue = new JobQueue();
