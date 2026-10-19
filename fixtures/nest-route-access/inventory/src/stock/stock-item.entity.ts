import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('stock_items')
export class StockItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  quantity: number;
}
