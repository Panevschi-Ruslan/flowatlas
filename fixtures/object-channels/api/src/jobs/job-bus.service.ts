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
 *
 * The record is also not the message. `queue` is handed a name and a payload
 * together and the worker at the other end is handed the payload alone, so a
 * description that pointed at argument 0 and stopped there compared an envelope
 * against a message and reported the difference as somebody's mistake (R133).
 * `payloadPath` is where the configuration says which property carries the
 * message.
 */
export type JobName = 'thumbnail.generate' | 'mail.send' | 'index.rebuild';

export interface ThumbnailJobData {
  readonly orderId: string;
}

export interface MailJobData {
  readonly orderId: string;
}

export interface RebuildJobData {
  readonly since?: string;
}

/**
 * Every job the bus can carry, discriminated by its name.
 *
 * Which of them a call sends is decided by the name it writes, which is the
 * shape a bus of one's own usually has and the one the reader already narrows
 * by: the declaration is the whole union and the call site is one member of it.
 */
export type JobItem =
  | { readonly name: 'thumbnail.generate'; readonly data: ThumbnailJobData }
  | { readonly name: 'mail.send'; readonly data: MailJobData }
  | { readonly name: 'index.rebuild'; readonly data: RebuildJobData };

@Injectable()
export class JobBus {
  queue(item: JobItem): void {
    void item;
  }

  queueAll(items: readonly JobItem[]): void {
    void items;
  }
}
