import { Injectable } from '@nestjs/common';

export interface Order {
  id: string;
  depotId: string;
  status: string;
}

/** What both frameworks end up calling, whichever way in was taken. */
@Injectable()
export class OrdersService {
  list(depotId: string): Promise<Order[]> {
    return Promise.resolve([{ id: 'o1', depotId, status: 'new' }]);
  }

  cancel(depotId: string, orderId: string): Promise<void> {
    void depotId;
    void orderId;
    return Promise.resolve();
  }

  /** The stream a worker route holds open, rather than a request it answers. */
  changesFor(depotId: string): Promise<string> {
    return Promise.resolve(`changes:${depotId}`);
  }
}
