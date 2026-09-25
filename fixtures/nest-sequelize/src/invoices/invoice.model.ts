import { DataTypes, Model, Sequelize } from 'sequelize';

export const connection = new Sequelize();

/**
 * The class form. Nothing about `Invoice` names a table; `init` states it, and
 * the class is data access only because what it extends comes from the library.
 */
export class Invoice extends Model {}

Invoice.init(
  {
    id: DataTypes.STRING,
    userId: DataTypes.STRING,
    amount: DataTypes.INTEGER,
  },
  { sequelize: connection, modelName: 'invoice', tableName: 'invoices' },
);

/** The other form: the table is the first argument of `define`. */
export const Payment = connection.define('payments', {
  id: DataTypes.STRING,
  invoiceId: DataTypes.STRING,
});
