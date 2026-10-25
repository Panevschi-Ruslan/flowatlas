import { ClassSerializerInterceptor, Controller, Get, Param, UseGuards, UseInterceptors } from '@nestjs/common';

import { MemberGuard } from '../guards/member.guard';
import { FallbackPriceInterceptor } from '../interceptors/fallback-price.interceptor';
import { UpstreamInterceptor } from '../interceptors/upstream.interceptor';
import { BooksService } from './books.service';

@Controller('books')
@UseGuards(MemberGuard)
@UseInterceptors(ClassSerializerInterceptor, UpstreamInterceptor)
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Get(':id')
  find(@Param('id') id: string) {
    return this.books.find(id);
  }

  @Get(':id/price')
  @UseInterceptors(FallbackPriceInterceptor)
  price(@Param('id') id: string) {
    return this.books.price(id);
  }
}
