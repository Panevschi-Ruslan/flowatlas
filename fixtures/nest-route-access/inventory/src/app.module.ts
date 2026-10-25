import { Module } from '@nestjs/common';

import { LevelsController } from './stock/levels.controller';
import { ReceiptsController } from './stock/receipts.controller';
import { StockController } from './stock/stock.controller';
import { STOCK_SERVICES } from './stock/services';

/** No global guard here: each controller decides for itself. */
@Module({
  controllers: [StockController, ReceiptsController, LevelsController],
  providers: STOCK_SERVICES,
})
export class AppModule {}
