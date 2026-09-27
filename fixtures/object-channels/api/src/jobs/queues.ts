import { Injectable } from '@nestjs/common';

/**
 * One class per queue, which is the other house style a description could not
 * reach.
 *
 * `this.mail.push(payload)` writes nothing about which queue: the receiver *is*
 * the queue, and the name was stated once, in the `super(...)` every instance of
 * `MailQueue` goes through. Nothing is missing from the source — the name is one
 * indirection away, which is what the `base-constructor-argument` locator is for.
 */
export class QueueBase {
  constructor(private readonly topic: string) {}

  push(payload: object): void {
    void this.topic;
    void payload;
  }
}

export interface MailPayload {
  readonly to: string;
  readonly subject: string;
}

export interface DigestPayload {
  readonly userId: string;
}

/** The queue named `mail.send`, which is the same queue the worker handles. */
@Injectable()
export class MailQueue extends QueueBase {
  constructor() {
    super('mail.send');
  }
}

/**
 * A second queue of the same shape, so the reading is per class rather than per
 * call: two receivers of two types land on two channels.
 */
@Injectable()
export class DigestQueue extends QueueBase {
  constructor() {
    super('digest.send');
  }
}

/** A topic settled at run time, which is no name a reader can follow. */
const tenantTopic = (): string => String(Math.random());

/**
 * A queue whose name is not written down anywhere a reader can follow.
 *
 * The control: the locator points at an expression and the expression is a call,
 * so there is no name, and the producer must stay in the graph with no channel
 * and a row against it rather than a node minted from a guess (R83).
 */
@Injectable()
export class TenantQueue extends QueueBase {
  constructor() {
    super(tenantTopic());
  }
}
