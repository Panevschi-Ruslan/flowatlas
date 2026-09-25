import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

import type { CancelOrder, OrderState, OrderSummary, OrderUpdate } from './order-events';
import { OrdersService } from './orders.service';

/**
 * The service end of the order socket.
 *
 * The namespace is declared once here and every event below is addressed within
 * it, so these are the `orders/…` channels and not the bare ones. The browser
 * opens the same namespace and writes the same event names; nothing joins the
 * two but the names, which is exactly what a channel node is for.
 */
@WebSocketGateway({ namespace: 'orders' })
export class OrdersGateway {
  @WebSocketServer()
  private readonly server: Server;

  constructor(private readonly orders: OrdersService) {}

  /** The browser publishes this; the gateway receives it. */
  @SubscribeMessage('order:cancel')
  cancel(@MessageBody() command: CancelOrder): void {
    const update = this.orders.cancel(command);
    this.server.emit('order:updated', update);
  }

  /**
   * The browser asks and waits for an answer, so its end of this is an `rpc`.
   *
   * This end is still an `event`: the decorator is the same one either way, and
   * nothing here says whether anybody is waiting for what the method returns.
   */
  @SubscribeMessage('order:summary')
  summarise(@MessageBody() orderId: string): OrderSummary {
    return this.orders.summarise(orderId);
  }

  /**
   * One publish, two channels.
   *
   * The name is assembled from a state, and the set of states is closed, so the
   * reader folds the template into the names it can actually reach rather than
   * leaving a hole that nothing in the browser would ever match.
   */
  publishLifecycle(state: OrderState, update: OrderUpdate): void {
    const verb = state.slice('ORDER_'.length).toLowerCase();
    this.server.emit(`order:${verb}`, update);
  }

  /**
   * A room, which is not a channel.
   *
   * `to(region)` names an audience inside this namespace; the event is still
   * `orders/order:updated` and the region is addressing. Reading the region as
   * part of the channel would invent one node per region and join the browser
   * to none of them.
   */
  notifyRegion(region: string, update: OrderUpdate): void {
    this.server.to(region).emit('order:updated', update);
  }
}
