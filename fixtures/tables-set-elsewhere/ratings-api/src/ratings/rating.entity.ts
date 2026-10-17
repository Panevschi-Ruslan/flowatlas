import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** The decorator states the table: `ratings`. */
@Entity('ratings')
export class Rating {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  stars: number;
}
