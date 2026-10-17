import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { Book, NewBook } from './book.js';
import { BooksService } from './books.service.js';

@Controller('books')
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Get()
  list(): Book[] {
    return this.books.list();
  }

  @Post()
  add(@Body() book: NewBook): Promise<Book> {
    return this.books.add(book);
  }

  @Delete(':isbn')
  remove(@Param('isbn') isbn: string): void {
    this.books.remove(isbn);
  }
}
