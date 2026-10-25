import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

/** Billing's reading of what `orders` publishes when an order is gift-wrapped. */
export interface GiftWrappedEvent {
  orderId: string;
}

/**
 * New in the head revision: the handler for the publish `orders` added, so
 * the flow of `POST /orders` gains two steps across two repositories.
 */
@Controller()
export class GiftWrapConsumer {
  @EventPattern('order.gift-wrapped')
  onGiftWrapped(@Payload() event: GiftWrappedEvent): void {
    void event;
  }
}
