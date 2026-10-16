import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  amount: number;
}
