import { Repository, Store } from './repository';

export interface Order {
  id: string;
  total: number;
}

/** The orders table, handed up to the base class from the environment the template sets. */
export class OrdersRepository extends Repository<Order> {
  constructor() {
    super(process.env.ORDERS_TABLE as string);
  }

  place(order: Order): Promise<void> {
    return this.save(order);
  }
}

/** The audit log: a repository whose table whoever builds it names. */
export class AuditRepository extends Repository<{ id: string; action: string }> {}

/** The carts, a store that sets the table its base only declares. */
export class CartStore extends Store<{ id: string; items: string[] }> {
  protected readonly table = 'shop-carts';
}
