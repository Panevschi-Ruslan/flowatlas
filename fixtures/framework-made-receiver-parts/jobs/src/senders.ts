import { Queue } from 'bullmq';

/** A sender whose queue a setup function lays over the instance it is handed, with no type. */
export class Digest {
  queue?: Queue;

  send(user: string) {
    return this.queue.add('digest', { user });
  }
}

function setup(target) {
  Object.assign(target, { queue: new Queue('digests', { connection: {} }) });
}

export const digest = new Digest();
setup(digest);

/** A sender whose queue is written on the instance a function is handed, plainly. */
export class Alerter {
  queue?: Queue;

  alert(message: string) {
    return this.queue.add('alert', { message });
  }
}

function wire(target) {
  target.queue = new Queue('alerts', { connection: {} });
}

export const alerter = new Alerter();
wire(alerter);
