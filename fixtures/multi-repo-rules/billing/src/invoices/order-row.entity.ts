import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Billing's own mapping of the `orders` table, which `orders` owns.
 * Expected: `rules` reports `only-orders-writes-orders` broken here, once,
 * at the write in `InvoicesService.markInvoiced`.
 */
@Entity('orders')
export class OrderRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  status: string;
}
