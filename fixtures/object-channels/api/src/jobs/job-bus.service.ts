import { Injectable } from '@nestjs/common';

/**
 * The house job bus, in the shape a large application actually writes.
 *
 * One method, one options object, and the name of the queue inside it. There is
 * no library here for an adapter to detect and there is nothing at argument 0 but
 * a record: a description that could only say "argument 0" read the whole record
 * and produced a channel named after its own text, which nothing at the other end
 * of the wire could ever write (R83). What names the channel is the `name`
 * property, and `flowatlas.config.json` is where that is said.
 */
export type JobName = 'thumbnail.generate' | 'mail.send' | 'index.rebuild';

export interface JobItem {
  readonly name: JobName;
  readonly data: Record<string, unknown>;
}

@Injectable()
export class JobBus {
  queue(item: JobItem): void {
    void item;
  }

  queueAll(items: readonly JobItem[]): void {
    void items;
  }
}
