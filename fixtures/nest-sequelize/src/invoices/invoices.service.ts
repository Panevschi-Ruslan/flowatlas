import { Injectable } from '@nestjs/common';

import { Invoice, Payment, connection } from './invoice.model.js';

@Injectable()
export class InvoicesService {
  // A read on the class form: the table is what `Invoice.init` stated.
  findAll(): Promise<unknown[]> {
    return Invoice.findAll();
  }

  findOne(id: string): Promise<unknown> {
    return Invoice.findByPk(id);
  }

  // A write on the class form.
  create(amount: number): Promise<unknown> {
    return Invoice.create({ amount });
  }

  markPaid(id: string): Promise<unknown> {
    return Invoice.update({ status: 'paid' }, { where: { id } });
  }

  // A read on the `define` form, whose table is the first argument of `define`.
  payments(): Promise<unknown[]> {
    return Payment.findAll();
  }

  remove(id: string): Promise<number> {
    return Invoice.destroy({ where: { id } });
  }

  // The model is chosen by name at run time, so nothing can be read from the
  // source. Expected: the query is still a node, with no table and a
  // `dynamic-table-name` row saying why.
  countOf(name: string): Promise<number> {
    return connection.models[name]!.count();
  }
}
