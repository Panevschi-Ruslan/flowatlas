import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('loans')
export class Loan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  copyId: string;

  @Column({ type: 'date' })
  dueOn: string;
}
