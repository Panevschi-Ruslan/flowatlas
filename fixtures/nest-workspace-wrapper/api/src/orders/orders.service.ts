import { Injectable } from '@nestjs/common';
import { db, OrdersRepository, type Order } from '@acme/db';

/**
 * Every query goes through `@acme/db`, a package of this project's own that is
 * not a library anything describes.
 *
 * Neither call can be read as data access without being told, and neither row is
 * about this service: the fix for both is one line naming a class that lives in
 * `@acme/db`, so both rows name the package.
 */
@Injectable()
export class OrdersService {
  // Constructed rather than injected, so that the only thing this fixture says
  // about the class is what it says about data.
  private readonly orders = new OrdersRepository();

  // A shared value whose name is the only evidence: `db-receiver-name-only`.
  recent(): Promise<Order[]> {
    return db.findOrders();
  }

  // A class that reads as a data layer, read through nothing: `db-layer-unread`.
  all(): Promise<Order[]> {
    return this.orders.findAll();
  }
}
