import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('catalogue_items')
export class CatalogueItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;
}
