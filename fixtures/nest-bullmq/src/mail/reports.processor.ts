import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import type { ReportJob } from './jobs';

/**
 * A worker nothing in this repository reaches.
 *
 * Unlike the other three processors it is listed in no module, no constructor
 * asks for it, and nothing calls `process`: the only way in is the `reports`
 * queue itself, which is the ordinary shape of a worker deployed on its own and
 * fed by a service in another repository.
 *
 * Receiving used to be skipped unless an earlier pass had already put the
 * method in the graph, and for this class no earlier pass does — so the handler
 * was invisible and the queue it reads had no reader anywhere in the output
 * (R60). Expected now: `channel:reports` with `meta.channelKind: "queue"`, one
 * `consumer` on `process`, the `consumes` edge between them, and the `method`
 * and `provider` nodes the `handles` edge needs — created by the consumer
 * emitter rather than found there.
 *
 * It is also the one processor here that names its queue in the options object
 * rather than as a bare string, which is the other overload the real decorator
 * takes. Before the channel side was described with locators the reader read the
 * whole object and produced `channel:{"name":"reports"}` — a node nothing else
 * could ever write (R86, R83).
 */
@Processor({ name: 'reports' })
export class ReportsProcessor extends WorkerHost {
  async process(job: Job<ReportJob>): Promise<void> {
    void job.data.reportId;
  }
}
