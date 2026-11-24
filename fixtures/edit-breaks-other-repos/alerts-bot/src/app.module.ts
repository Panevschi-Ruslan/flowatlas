import { Module } from '@nestjs/common';
import { StockAlerts } from './stock.alerts';

@Module({
  providers: [StockAlerts],
})
export class AppModule {}
