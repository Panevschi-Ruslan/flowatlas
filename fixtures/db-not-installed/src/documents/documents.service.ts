import { Injectable } from '@nestjs/common';

import { Document } from './document.model.js';

/**
 * The model called as a class, which is the ordinary way this mapper is used.
 *
 * The receiver is the class itself, so the table is whatever the class states -
 * and the class is here, in this repository, decorated.
 */
@Injectable()
export class DocumentsService {
  findAll(): Promise<unknown[]> {
    return Document.findAll();
  }

  create(title: string): Promise<unknown> {
    return Document.create({ title });
  }
}
