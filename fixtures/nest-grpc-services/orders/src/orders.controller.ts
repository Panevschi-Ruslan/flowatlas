import { Controller } from '@nestjs/common';
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { Observable, of } from 'rxjs';

interface Order {
  id: string;
  status: string;
}

const SERVICE = process.env.ORDERS_SERVICE_NAME;

@Controller()
export class OrdersController {
  private readonly orders: Order[] = [{ id: 'o1', status: 'placed' }];

  @GrpcMethod('OrdersService', 'FindOrder')
  findOrder(request: { id: string }): Order | undefined {
    return this.orders.find((order) => order.id === request.id);
  }

  // The method's name, its first letter raised, is the method it answers.
  @GrpcMethod('OrdersService')
  listOrders(): Observable<Order> {
    return of(...this.orders);
  }

  @GrpcStreamMethod('OrdersService', 'StreamUpdates')
  streamUpdates(updates: Observable<Order>): Observable<Order> {
    return updates;
  }

  // Named at run time: nothing can say which service this answers.
  @GrpcMethod(SERVICE, 'CancelOrder')
  cancelOrder(request: { id: string }): Order {
    return { id: request.id, status: 'cancelled' };
  }
}
