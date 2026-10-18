import { Injectable } from '@nestjs/common';

import { BookNotFound, PlainFailure } from '../errors';

@Injectable()
export class BooksService {
  private readonly prices = new Map<string, number>([['b-1', 12]]);

  find(id: string): { id: string } {
    if (id === '') throw new PlainFailure('no id');
    if (!this.prices.has(id)) throw new BookNotFound(id);
    return { id };
  }

  price(id: string): { price: number } {
    const price = this.prices.get(id);
    if (price === undefined) throw new BookNotFound(id);
    return { price };
  }
}
