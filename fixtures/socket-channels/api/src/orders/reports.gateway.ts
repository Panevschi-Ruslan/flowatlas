import { MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';

import { REPORTS_NAMESPACE } from './settings';
import type { OrderSummary } from './order-events';

/**
 * The namespace itself cannot be read, so none of this gateway's channels can.
 *
 * The event name below is a plain literal and would resolve on its own; it is
 * the endpoint it sits under that is missing. Falling back to the root
 * namespace here would put this handler on the same node as `AuditGateway`'s,
 * which is a claim about two classes that nothing in the source supports.
 */
@WebSocketGateway({ namespace: REPORTS_NAMESPACE })
export class ReportsGateway {
  @SubscribeMessage('report:requested')
  request(@MessageBody() summary: OrderSummary): void {
    void summary;
  }
}
