import { Injectable } from '@nestjs/common';

import { Document, Revision, connection } from './document.model.js';

@Injectable()
export class DocumentsService {
  // The plain static call. The receiver is a class of this repository, and the
  // only reason it is data access at all is that its base chain reaches a class
  // `sequelize-typescript` declares — which is not the package the descriptor is
  // written for.
  findOne(id: string): Promise<unknown> {
    return Document.findByPk(id);
  }

  // The scoped call, which is the shape nearly every query in outline takes. The
  // scope retypes the receiver to sequelize's own `ModelStatic`, so this one was
  // always recognised as data access; what could not be read was the table,
  // because the receiver is a call rather than a name.
  withOwner(): Promise<unknown[]> {
    return Document.scope('withOwner').findAll();
  }

  // Two narrowing calls in a row, neither of which is another table.
  everything(): Promise<unknown> {
    return Document.unscoped().scope('withOwner').findOne();
  }

  create(title: string): Promise<unknown> {
    return Document.create({ title });
  }

  // An instance. The table is written nowhere in the call, and the class the
  // receiver is typed as is the only statement of it.
  async rename(id: string, title: string): Promise<unknown> {
    const doc = await Document.findByPk(id);
    return doc.update({ title });
  }

  remove(id: string): Promise<number> {
    return Document.destroy({ where: { id } });
  }

  // A second table, so the fixture has more than one table node, and a model
  // that states only its model name.
  revisions(documentId: string): Promise<unknown[]> {
    return Revision.findAll({ where: { documentId } });
  }

  // Not an operation. Reloading a row the query already produced is not a second
  // visit to the database, and counting it beats emitting one.
  async refresh(id: string): Promise<unknown> {
    const doc = await Document.findByPk(id);
    return doc.reload();
  }

  // The model is chosen by name at run time, so nothing can be read from the
  // source. Expected: the query is still a node, with no table and a
  // `dynamic-table-name` row saying why.
  countOf(name: string): Promise<number> {
    return connection.models[name]!.count();
  }
}
