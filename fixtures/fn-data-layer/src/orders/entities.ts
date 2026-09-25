import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * An entity whose name carries no wrapper suffix, and one whose name does.
 *
 * The pair is the point. `Repository<Order>` and `Repository<InvoiceEntity>` are the
 * same fact written two ways, and the write used to record the document it stores only
 * for the second of them, because the recording hung off the suffix having been
 * stripped (R48).
 */
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'int' })
  total: number;

  @Column({ type: 'varchar' })
  note: string;
}

@Entity('invoices')
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  orderId: string;

  @Column({ type: 'int' })
  amount: number;
}
