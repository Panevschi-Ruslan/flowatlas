import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** The decorator states the table in its options: `reviewer_badges`. */
@Entity({ name: 'reviewer_badges' })
export class Badge {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  label: string;
}
