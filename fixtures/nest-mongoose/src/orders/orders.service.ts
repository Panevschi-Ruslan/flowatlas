import { Injectable } from '@nestjs/common';
import { models } from 'mongoose';

import { OrderModel, type OrderDocument } from './order.model.js';

@Injectable()
export class OrdersService {
  // A read through the model. The collection comes from the declaration the
  // receiver names; the document type comes from `Model<OrderDocument>`.
  async findAll(): Promise<OrderDocument[]> {
    return OrderModel.find({});
  }

  async findOne(id: string): Promise<OrderDocument | null> {
    return OrderModel.findById(id);
  }

  // A write, which is what `stripImpact` asks about: the document it stores is
  // recorded on the node, so a field a validation pipe strips off the body can
  // be checked against the fields of `OrderDocument` rather than shrugged at.
  create(order: OrderDocument): Promise<OrderDocument> {
    return OrderModel.create(order);
  }

  async markPaid(id: string): Promise<unknown> {
    return OrderModel.updateOne({ id }, { status: 'paid' });
  }

  // A write through a document rather than through the model. The document was
  // made from the model, and the model is what names the collection.
  note(order: OrderDocument): Promise<OrderDocument> {
    const document = new OrderModel(order);
    return document.save();
  }

  async remove(id: string): Promise<unknown> {
    return OrderModel.deleteOne({ id });
  }

  // The model is chosen by name at run time, so neither the collection nor the
  // document can be read. Expected: the query is still a node, with no table
  // and a `dynamic-table-name` row saying why.
  async countOf(collection: string): Promise<number> {
    return models[collection]!.countDocuments({});
  }
}

// Every query method above is `async` because a mongoose query is not a
// promise. `find`, `findById`, `countDocuments`, `updateOne` and `deleteOne`
// all answer with a `Query`: thenable, so it can be awaited or returned from an
// `async` method, and not assignable to `Promise`, so it cannot be returned
// from a plain one. The stub said `Promise` here for a long while, which let
// these be written without the keyword — a smaller declaration is allowed, a
// differently shaped one is not.
//
// The note sits at the foot of the file because node ids carry line numbers;
// see the fixture section of the repository README.
