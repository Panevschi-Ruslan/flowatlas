import { dataSource } from '../data-source.js';
import { InvoiceEntity, Order } from './entities.js';

/**
 * The same four queries as `orders.repository.ts`, written as a class.
 *
 * Here so that the two can be compared rather than described: whatever the reader
 * records for a method it must record for the function beside it, down to the operation,
 * the table and the document a write stores.
 */
export class OrdersService {
  private readonly orders = dataSource.getRepository<Order>(Order);

  private readonly invoices = dataSource.getRepository<InvoiceEntity>(InvoiceEntity);

  async listOrders(): Promise<Order[]> {
    return this.orders.find();
  }

  async saveOrder(order: Order): Promise<Order> {
    return this.orders.save(order);
  }

  async archiveOrder(id: string): Promise<void> {
    const purge = async (): Promise<void> => {
      await this.orders.delete(id);
    };
    await purge();
  }

  async saveInvoice(invoice: InvoiceEntity): Promise<InvoiceEntity> {
    return this.invoices.save(invoice);
  }
}
