import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

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
}
