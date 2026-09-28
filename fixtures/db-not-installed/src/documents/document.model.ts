import { Column, Model, Table } from 'sequelize-typescript';

/**
 * A base of the project's own over the library's model, which is how a real
 * repository factors the behaviour every model shares. The walk up the chain is
 * two hops here and both of them are in this repository: a relative import
 * resolves with no `node_modules` at all, and the hop that leaves the repository
 * is the one the import statement answers.
 */
export class BaseModel extends Model {
  @Column({ primaryKey: true })
  id!: string;
}

/** The table is stated in the decorator, which needs nothing installed to read. */
@Table({ tableName: 'documents' })
export class Document extends BaseModel {
  @Column({})
  title!: string;
}
