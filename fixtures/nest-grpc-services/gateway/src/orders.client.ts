import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable } from 'rxjs';

interface Order {
  id: string;
  status: string;
}

interface OrdersService {
  findOrder(request: { id: string }): Observable<Order>;
  listOrders(request: { customerId: string }): Observable<Order>;
}

@Injectable()
export class OrdersClient implements OnModuleInit {
  private orders: OrdersService;

  constructor(@Inject('ORDERS') private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.orders = this.client.getService<OrdersService>('OrdersService');
  }

  find(id: string): Promise<Order> {
    return firstValueFrom(this.orders.findOrder({ id }));
  }

  byCustomer(customerId: string): Observable<Order> {
    return this.orders.listOrders({ customerId });
  }
}
