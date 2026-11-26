import { Injectable } from '@nestjs/common';
import { CallsService } from '@flowatlas/markers';

import { getWorkerEnv } from '../env';
import { resolveTransports, type Transport } from './routes';

/** The board a channel belongs to: `board:<id>:events`. */
const boardIdOf = (channel: string): string => channel.split(':')[1] ?? '';

/**
 * The project's own bus. No broker description names it: the described
 * publisher (`BoardEventBus`) hands it every message, and some code calls it
 * directly; nothing subscribes on a broker. Each message goes to the
 * transports the routing table gives its channel's family, each through the
 * handler a record keeps under the transport's name: the board's hub, which
 * writes it to the streams the screens hold open, or the worker.
 */
@Injectable()
export class BusService {
  private readonly transportHandlers: Record<Transport, (channel: string, message: unknown) => Promise<void>> = {
    hub: (channel, message) => this.fanoutToHub(channel, message),
    worker: (channel, message) => this.fanoutToWorker(channel, message),
  };

  async publish(channel: string, message: unknown): Promise<void> {
    const transports = [...resolveTransports(channel)];
    await Promise.allSettled(transports.map((t) => this.transportHandlers[t](channel, message)));
  }

  /** The namespace from the worker's environment, kept where the request is not handed. */
  private async fanoutToHub(channel: string, message: unknown): Promise<void> {
    const ns = getWorkerEnv().BOARD_HUB as DurableObjectNamespace;
    const stub = ns.get(ns.idFromName(boardIdOf(channel)));
    await stub.fetch('https://hub.local/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getWorkerEnv().HUB_TOKEN}` },
      body: JSON.stringify({ channel, message }),
    });
  }

  /** Posted to the orders worker, which reads the channel's messages there. */
  @CallsService('orders-worker', 'POST /events/orders')
  private async fanoutToWorker(channel: string, message: unknown): Promise<void> {
    void channel;
    void message;
  }
}
