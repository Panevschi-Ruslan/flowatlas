import { Schema, model } from 'mongoose';

/**
 * The document, whose name carries the persistence suffix a reader is not
 * looking for: the data is an order, and `stripWrapperSuffix` is what says so.
 */
export interface OrderDocument {
  id: string;
  userId: string;
  total: number;
  note: string;
}

const orderSchema = new Schema<OrderDocument>({
  id: String,
  userId: String,
  total: Number,
  note: String,
});

/** The collection is this string, and it is in no type at all. */
export const OrderModel = model<OrderDocument>('orders', orderSchema);
