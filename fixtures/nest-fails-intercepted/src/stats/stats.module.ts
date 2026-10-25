import { Module } from '@nestjs/common';

import { BooksModule } from '../books/books.module';
import { StatsController } from './stats.controller';

@Module({
  imports: [BooksModule],
  controllers: [StatsController],
})
export class StatsModule {}
