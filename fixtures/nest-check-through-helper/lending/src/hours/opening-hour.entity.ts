import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('opening_hours')
export class OpeningHour {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  weekday: number;

  @Column()
  opens: string;
}
