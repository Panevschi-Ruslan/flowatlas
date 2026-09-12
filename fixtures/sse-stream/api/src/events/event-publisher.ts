import type { DepotEvent } from './depot-event';

/**
 * The bus as the services that publish on it see it.
 *
 * Injected by token, so the type at every publishing call site is this
 * interface and never the class behind it — which is why the configuration
 * names both.
 */
export interface EventPublisher {
  publish(channel: string, event: DepotEvent): Promise<void>;
}

export const EVENT_PUBLISHER = 'EVENT_PUBLISHER';
