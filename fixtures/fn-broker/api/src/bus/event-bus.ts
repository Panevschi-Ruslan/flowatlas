/**
 * The house bus, as this service sees it.
 *
 * There is no broker library here for an adapter to detect: `publish` and
 * `subscribe` are ordinary methods, and `flowatlas.config.json` is what makes
 * them a producer and a subscriber (I2: ordinary configuration, not a
 * privileged code path).
 *
 * It is exported as one ready-made value rather than injected, because that is
 * how a service without a container reaches a client — and because a publish
 * through a module-level constant is exactly the spelling that used to produce
 * nothing at all.
 */
export class EventBus {
  publish<T>(channel: string, payload: T): void {
    void channel;
    void payload;
  }

  subscribe<T>(channel: string, handler: (payload: T) => void): void {
    void channel;
    void handler;
  }
}

export const bus = new EventBus();
