import { Module } from '@nestjs/common';

import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StatusController } from './status.controller';

@Module({
  controllers: [ProductsController, StatusController],
  providers: [ProductsService],
})
export class ProductsModule {}
