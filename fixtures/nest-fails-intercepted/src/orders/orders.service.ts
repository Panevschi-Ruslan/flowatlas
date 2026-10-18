import { Injectable } from '@nestjs/common';

import { BookNotFound, PlainFailure, StockExhausted } from '../errors';
import { CreateOrderDto } from './create-order.dto';

@Injectable()
export class OrdersService {
  private readonly stock = new Map<string, number>([['b-1', 3]]);

  place(dto: CreateOrderDto): { id: string } {
    const left = this.stock.get(dto.bookId);
    if (left === undefined) throw new BookNotFound(dto.bookId);
    if (left < dto.copies) throw new StockExhausted(`only ${left} left`);
    if (dto.copies > 100) throw new PlainFailure('too many copies');
    this.stock.set(dto.bookId, left - dto.copies);
    return { id: `o-${dto.bookId}` };
  }
}
