import { Injectable } from '@nestjs/common';

/**
 * The in-house bus (D3): no broker library anywhere, just a class with a
 * `publish` method and an in-process listener table.
 *
 * Nothing in `package.json` can detect this, which is the point. It becomes a
 * producer only through `adapters.broker.custom` in this fixture's
 * `flowatlas.config.json`, which names `receiverType: ["EventBusService"]`,
 * `method: "publish"`, `channelArg: 0`, `payloadArg: 1`. That entry is ordinary
 * adapter configuration, not a privileged code path (I2).
 */
@Injectable()
export class EventBusService {
  private readonly listeners = new Map<string, Array<(payload: unknown) => void>>();

  publish<T>(channel: string, payload: T): void {
    for (const listener of this.listeners.get(channel) ?? []) {
      listener(payload);
    }
  }

  on<T>(channel: string, listener: (payload: T) => void): void {
    const existing = this.listeners.get(channel) ?? [];
    existing.push(listener as (payload: unknown) => void);
    this.listeners.set(channel, existing);
  }
}
