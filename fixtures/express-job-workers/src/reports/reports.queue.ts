import Queue from 'bull';

const reportsQueue = new Queue('reports-queue');

/** The older library: a worker is a call on the queue itself. */
export class ReportsQueue {
  start(): void {
    reportsQueue.process('build-report', 2, (job) => this.build(job));
  }

  request(storeId: string) {
    return reportsQueue.add('build-report', { storeId });
  }

  private async build(job: { data: { storeId: string } }): Promise<void> {
    console.log('report for', job.data.storeId);
  }
}
