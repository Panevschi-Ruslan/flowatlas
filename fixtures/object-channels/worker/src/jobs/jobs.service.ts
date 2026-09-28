import { Injectable } from '@nestjs/common';

import { OnJob } from './on-job.decorator';

export interface ThumbnailJob {
  readonly orderId: string;
}

export interface MailJob {
  readonly orderId: string;
}

/** A name settled at run time, which is no name a reader can follow. */
const legacyJobName = (): string => String(Math.random());

/**
 * Receiving, with the channel named the same way the publisher named it.
 *
 * `channel:thumbnail.generate` and `channel:mail.send` each get both ends here and
 * join across the two services; `channel:index.rebuild` is published and never
 * handled, and `channel:digest.send` is the same, which is what a queue nobody has
 * written a worker for looks like from inside a project.
 */
@Injectable()
export class JobsService {
  @OnJob({ name: 'thumbnail.generate', queue: 'thumbnails' })
  handleThumbnail(job: ThumbnailJob): void {
    void job.orderId;
  }

  @OnJob({ name: 'mail.send', queue: 'mail' })
  handleMail(job: MailJob): void {
    void job.orderId;
  }

  /**
   * The control at this end: the decorator carries an options object and the
   * property that should hold the name is a computed value, so there is no
   * channel to draw and a row says so.
   */
  @OnJob({ name: legacyJobName() })
  handleLegacy(job: MailJob): void {
    void job.orderId;
  }
}
