import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StockService } from './stock.service';

/** A job: every night it tops up what ran low. */
@Injectable()
export class StockJobs {
  constructor(private readonly stock: StockService) {}

  @Cron('0 3 * * *')
  nightly(): void {
    if (this.stock.level('basket') < 10) this.stock.restock('basket');
  }
}
