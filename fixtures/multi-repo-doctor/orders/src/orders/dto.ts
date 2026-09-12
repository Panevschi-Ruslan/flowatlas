/**
 * What `orders` declares it is given, which is not what `gateway` sends.
 *
 * `channel` is required here and absent from the gateway's copy of the name.
 * Nothing in either repository compares the two, which is why the check has to.
 */
export class CreateOrderDto {
  id: string;
  total: number;
  channel: string;
}

export class OrderDto {
  id: string;
  total: number;
}

export interface OrderCreatedEvent {
  id: string;
  total: number;
}

export interface Order {
  id: string;
  total: number;
}
