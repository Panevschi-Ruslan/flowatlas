import { Module } from '@nestjs/common';

import { MemberGuard } from '../guards/member.guard';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';

@Module({
  controllers: [BooksController],
  providers: [BooksService, MemberGuard],
  exports: [BooksService],
})
export class BooksModule {}
