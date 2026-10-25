import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { Order } from './order.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  // One query per id: `inLoop` of kind `for-of`, and a `query-in-loop` row.
  async byIdsOneByOne(ids: string[]): Promise<Order[]> {
    const found: Order[] = [];
    for (const id of ids) {
      const order = await this.orders.findOne({ where: { id } });
      if (order) found.push(order);
    }
    return found;
  }

  // One query per id, run side by side: `inLoop` of kind `map` and `concurrent`.
  byIdsTogether(ids: string[]): Promise<Array<Order | null>> {
    return Promise.all(ids.map((id) => this.orders.findOne({ where: { id } })));
  }

  // Two different calls side by side: both `concurrent`, neither in a loop.
  async summary(userId: string): Promise<[Order[], Order | null]> {
    return Promise.all([this.orders.find({ where: { userId } }), this.orders.findOne({ where: { userId } })]);
  }

  // The list a loop walks is read once, before it: not in the loop.
  async totals(): Promise<number> {
    let sum = 0;
    for (const order of await this.orders.find()) sum += order.total;
    return sum;
  }

  // A loop around a call to a method that queries: the row names the method it goes through.
  async saveAll(list: Order[]): Promise<void> {
    for (let i = 0; i < list.length; i += 1) {
      await this.saveOne(list[i]);
    }
  }

  saveOne(order: Order): Promise<Order> {
    return this.orders.save(order);
  }

  // A function made in the loop and handed elsewhere runs when it is called, not here.
  later(ids: string[]): Array<() => Promise<void>> {
    const out: Array<() => Promise<void>> = [];
    for (const id of ids) out.push(() => this.orders.delete(id));
    return out;
  }
}
