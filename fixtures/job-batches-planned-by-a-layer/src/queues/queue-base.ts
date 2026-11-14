import { BullClient, QueuedJob } from './bull-client.js';

export enum Topic {
  Mail = 'mail',
  Invoices = 'invoices',
}

/** The longest delay the relay takes; anything later waits in the scheduler, or in the queue. */
const RELAY_MAX_DELAY = 15 * 60 * 1000;

/** Carries the jobs a relay never took, so a fallback queues exactly those. */
export class PartialSendError extends Error {
  constructor(
    public readonly unsentJobs: QueuedJob[],
    public readonly cause: unknown,
  ) {
    super(String(cause));
  }
}

class Relay {
  enabled = process.env.JOB_RELAY !== undefined;

  async send(topic: string, jobs: QueuedJob[]): Promise<void> {
    if (!this.enabled) throw new Error(`no relay for ${topic} (${jobs.length} jobs)`);
  }
}

class Scheduler {
  enabled = process.env.JOB_SCHEDULER !== undefined;

  async schedule(topic: string, jobs: QueuedJob[]): Promise<void> {
    if (!this.enabled) throw new Error(`no scheduler for ${topic} (${jobs.length} jobs)`);
  }
}

/**
 * Every queue of the shop is one of these, its topic handed in by the class
 * extending it. A batch is planned first - which jobs go to the queue, which
 * to the scheduler, which to the relay - and a relay that refuses some of
 * them hands back the ones it never sent, which go to the queue.
 */
export class QueueBase {
  private relay = new Relay();
  private scheduler = new Scheduler();

  constructor(
    public readonly topic: Topic,
    private readonly bull: BullClient,
  ) {}

  open(): void {
    this.bull.openQueue(this.topic);
  }

  async add(job: QueuedJob): Promise<void> {
    if (!this.relay.enabled) return this.addToBull(job);
    return this.dispatch([job]);
  }

  async addBulk(jobs: QueuedJob[]): Promise<void> {
    if (!this.relay.enabled) return this.bull.addBulk(jobs);
    return this.dispatch(jobs);
  }

  private async dispatch(jobs: QueuedJob[]): Promise<void> {
    const { toBull, toScheduler, toRelay } = this.planDispatch(jobs);
    if (toBull.length > 0) await this.addAllToBull(toBull);
    try {
      await this.sendElsewhere(toScheduler, toRelay);
    } catch (error) {
      await this.fallBack(error, [...toScheduler, ...toRelay]);
    }
  }

  private planDispatch(jobs: QueuedJob[]): { toBull: QueuedJob[]; toScheduler: QueuedJob[]; toRelay: QueuedJob[] } {
    const { later, soon } = this.separateByDelay(jobs);
    if (later.length === 0) return { toBull: [], toScheduler: [], toRelay: soon };
    if (this.scheduler.enabled) return { toBull: [], toScheduler: later, toRelay: soon };
    return { toBull: later, toScheduler: [], toRelay: soon };
  }

  private separateByDelay(jobs: QueuedJob[]): { later: QueuedJob[]; soon: QueuedJob[] } {
    const later: QueuedJob[] = [];
    const soon: QueuedJob[] = [];
    for (const job of jobs) {
      if ((job.delay ?? 0) > RELAY_MAX_DELAY) later.push(job);
      else soon.push(job);
    }
    return { later, soon };
  }

  private async sendElsewhere(toScheduler: QueuedJob[], toRelay: QueuedJob[]): Promise<void> {
    if (toScheduler.length > 0) {
      try {
        await this.scheduler.schedule(this.topic, toScheduler);
      } catch (error) {
        throw new PartialSendError([...toScheduler, ...toRelay], error);
      }
    }
    try {
      await this.relay.send(this.topic, toRelay);
    } catch (error) {
      throw new PartialSendError(toRelay, error);
    }
  }

  private async fallBack(error: unknown, jobs: QueuedJob[]): Promise<void> {
    const unsent = error instanceof PartialSendError ? error.unsentJobs : jobs;
    console.warn('relay refused, falling back to the queue', error);
    if (unsent.length > 0) await this.addAllToBull(unsent);
  }

  private async addAllToBull(jobs: QueuedJob[]): Promise<void> {
    if (jobs.length === 1) return this.addToBull(jobs[0]);
    await this.bull.addBulk(jobs);
  }

  private async addToBull(job: QueuedJob): Promise<void> {
    await this.bull.add(job.name, job.data, job.delay);
  }
}

export class MailQueue extends QueueBase {
  constructor(bull: BullClient) {
    super(Topic.Mail, bull);
    this.open();
  }
}

export class InvoiceQueue extends QueueBase {
  constructor(bull: BullClient) {
    super(Topic.Invoices, bull);
    this.open();
  }
}
