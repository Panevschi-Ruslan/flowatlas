import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The entity is the single source of the table label: `Repository<Order>`
 * carries it in a type argument, so `db_query.meta.table` is `Order` and the
 * node is `table:orders#Order` — the far end of the chain §12 walks from
 * `entry:gateway:http:GET:/orders/:param`.
 */
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  customerId: string;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'int' })
  total: number;

  @Column({ type: 'varchar' })
  currency: string;
}
