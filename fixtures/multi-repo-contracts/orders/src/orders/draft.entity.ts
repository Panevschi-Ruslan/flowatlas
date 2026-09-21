import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The document the draft routes write, for telling three strips apart (R30).
 *
 * `Repository<DraftSchema>` carries the name in a type argument, so the table
 * is `Draft` and the entity the write names is `DraftSchema`. That name is the
 * whole join: a field the receiver's pipe removes is worth more attention when
 * the document the handler writes declares it, and worth less when it does not.
 */
@Entity('drafts')
export class DraftSchema {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  /** Declared here and *not* on `CreateDraftDto`, which is the whole point. */
  @Column({ type: 'varchar' })
  note: string;
}
