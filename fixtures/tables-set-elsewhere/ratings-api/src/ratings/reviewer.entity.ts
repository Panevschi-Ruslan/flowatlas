import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** The decorator states nothing: the table is the class's name, `Reviewer`. */
@Entity()
export class Reviewer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;
}
