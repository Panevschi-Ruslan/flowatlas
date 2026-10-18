import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';

import { BooksService } from '../books/books.service';
import { TranslateInterceptor } from '../interceptors/translate.interceptor';

@Controller('stats')
@UseInterceptors(TranslateInterceptor)
export class StatsController {
  constructor(private readonly books: BooksService) {}

  @Get(':id')
  price(@Param('id') id: string) {
    return this.books.price(id);
  }
}
