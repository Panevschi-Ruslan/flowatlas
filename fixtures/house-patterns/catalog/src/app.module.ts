import { Module } from '@nestjs/common';
import { BooksController } from './books/books.controller.js';
import { BooksService } from './books/books.service.js';

@Module({
  controllers: [BooksController],
  providers: [BooksService],
})
export class AppModule {}
