import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { BooksService } from './books.service';
import { HoldsService } from './holds.service';

/**
 * The lending back end's routes. `GET /books/:bookId` is also served by the
 * gateway, under the same path; `DELETE /books/:bookId/hold` is requested by
 * no code; `POST /books/:bookId/extend` is requested as `renew`, one segment
 * off, so no request joins it either.
 */
@Controller('books')
export class BooksController {
  constructor(
    private readonly books: BooksService,
    private readonly holds: HoldsService,
  ) {}

  @Get()
  list(): string[] {
    return this.books.list();
  }

  @Get(':bookId')
  findOne(@Param('bookId') bookId: string): string {
    return this.books.findOne(bookId);
  }

  @Post(':bookId/hold')
  hold(@Param('bookId') bookId: string): void {
    this.holds.place(bookId);
  }

  @Delete(':bookId/hold')
  release(@Param('bookId') bookId: string): void {
    this.holds.release(bookId);
  }

  @Post(':bookId/extend')
  extend(@Param('bookId') bookId: string): void {
    this.holds.extend(bookId);
  }
}
