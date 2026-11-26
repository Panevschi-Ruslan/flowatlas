import type { PresenceHub } from './objects/presence-hub';

/**
 * What the platform hands the worker. Only `PRESENCE` names its class in its
 * type; the others are said by the worker's configuration alone.
 */
export interface Env {
  BOARD_FEEDS: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace<PresenceHub>;
  ALERTS: DurableObjectNamespace;
  ALERTS_ID: string;
  ARCHIVE: DurableObjectNamespace;
  LEDGER: DurableObjectNamespace;
  REDIS_URL: string;
}
