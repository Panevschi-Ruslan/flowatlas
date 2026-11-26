import { Controller, Get, Param } from '@nestjs/common';
import { BooksClient } from './books.client';

/** `GET /books/:bookId`, the same path the back end serves: the desk bot asks here, and it asks the back end. */
@Controller('books')
export class BooksController {
  constructor(private readonly books: BooksClient) {}

  @Get(':bookId')
  findOne(@Param('bookId') bookId: string): Promise<string> {
    return this.books.fetch(bookId);
  }
}
