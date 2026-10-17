import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('holds')
export class Hold {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  copyId: string;
}
