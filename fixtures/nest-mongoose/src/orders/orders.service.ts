import { Injectable } from '@nestjs/common';
import { models } from 'mongoose';

import { OrderModel, type OrderDocument } from './order.model.js';

@Injectable()
export class OrdersService {
  // A read through the model. The collection comes from the declaration the
  // receiver names; the document type comes from `Model<OrderDocument>`.
  findAll(): Promise<OrderDocument[]> {
    return OrderModel.find({});
  }

  findOne(id: string): Promise<OrderDocument | null> {
    return OrderModel.findById(id);
  }

  // A write, which is what `stripImpact` asks about: the document it stores is
  // recorded on the node, so a field a validation pipe strips off the body can
  // be checked against the fields of `OrderDocument` rather than shrugged at.
  create(order: OrderDocument): Promise<OrderDocument> {
    return OrderModel.create(order);
  }

  markPaid(id: string): Promise<unknown> {
    return OrderModel.updateOne({ id }, { status: 'paid' });
  }

  // A write through a document rather than through the model. The document was
  // made from the model, and the model is what names the collection.
  note(order: OrderDocument): Promise<OrderDocument> {
    const document = new OrderModel(order);
    return document.save();
  }

  remove(id: string): Promise<unknown> {
    return OrderModel.deleteOne({ id });
  }

  // The model is chosen by name at run time, so neither the collection nor the
  // document can be read. Expected: the query is still a node, with no table
  // and a `dynamic-table-name` row saying why.
  countOf(collection: string): Promise<number> {
    return models[collection]!.countDocuments({});
  }
}
