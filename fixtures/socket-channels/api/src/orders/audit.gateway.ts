import { MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';

import { AUDIT_EVENT } from './settings';
import type { OrderUpdate } from './order-events';

/**
 * A gateway on the root namespace, which is a different endpoint entirely.
 *
 * `order:updated` here and `order:updated` in `OrdersGateway` are two channels,
 * because a socket namespace is a separate connection and nothing crosses
 * between them. Collapsing the two onto one node would say this class hears
 * what the browser and the orders gateway say to each other, which it does not.
 */
@WebSocketGateway()
export class AuditGateway {
  @SubscribeMessage('order:updated')
  record(@MessageBody() update: OrderUpdate): void {
    void update;
  }

  /**
   * The name is settled at run time, so there is no channel to join on.
   *
   * The browser writes the other end of this one the same way, and both ends
   * are reported; neither is guessed. That is the case the whole channel side
   * of the tool is careful about — a guessed name joins services that never
   * speak, and here there is nothing to guess from.
   */
  @SubscribeMessage(AUDIT_EVENT)
  audit(@MessageBody() update: OrderUpdate): void {
    void update;
  }
}
