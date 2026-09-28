// The project's own data layer, in a workspace package beside the service rather
// than inside it. It wraps a driver nothing here describes, so nothing about it
// says "data" except what it is called and what it is used for.
//
// A workspace reaches this through a link, not a copy, so the checker resolves it
// to this file: no `node_modules` in the path, which is why the reader sees a type
// the project declares rather than one a package does.

export interface Order {
  id: string;
  total: number;
}

/** A connection of the project's own, handed out as one shared value. */
export class Database {
  async findOrders(): Promise<Order[]> {
    return [];
  }

  async saveOrder(_order: Order): Promise<void> {}
}

export const db = new Database();

/** A repository class, injected where the value above is imported. */
export class OrdersRepository {
  async findAll(): Promise<Order[]> {
    return db.findOrders();
  }
}
