import { Sequelize } from 'sequelize';
import { Column, Model, Scopes, Table } from 'sequelize-typescript';

export const connection = new Sequelize();

/**
 * A base of the project's own, which is how a real repository factors the
 * behaviour every model shares. Nothing here is a table; what matters is that
 * the walk up the chain from a model reaches a class a package declares.
 */
export class BaseModel extends Model {
  @Column({ primaryKey: true })
  id!: string;
}

/**
 * The decorated form. Nothing in the class body states the table and no `init`
 * is ever written: `@Table` is the only statement of it, and the class shares
 * its name with one of the language's own global interfaces.
 */
@Scopes(() => ({ withOwner: {} }))
@Table({ tableName: 'documents', modelName: 'document' })
export class Document extends BaseModel {
  @Column({})
  title!: string;
}

/** A model that states only its model name, which is then the best answer. */
@Table({ modelName: 'revision' })
export class Revision extends BaseModel {
  @Column({})
  documentId!: string;
}
