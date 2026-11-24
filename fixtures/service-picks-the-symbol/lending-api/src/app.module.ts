import { Module } from '@nestjs/common';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { HoldsService } from './holds.service';

@Module({
  controllers: [BooksController],
  providers: [BooksService, HoldsService],
})
export class AppModule {}
