import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The entity is the single source of the table label: `Repository<Order>` carries it in
 * a type argument, so `db_query.meta.table` is `Order` (class name kept verbatim, per
 * P03 §4 — only names that come from `sql-parse` are lower-cased).
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
  status: string;
}
