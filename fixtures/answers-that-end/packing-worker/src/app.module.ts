import { Module } from '@nestjs/common';

import { ShopBus } from './bus/shop-bus.service';
import { AuditFeed } from './packing/audit-feed.service';
import { CourierPager } from './packing/courier-pager.service';
import { PackBoard } from './packing/pack-board.service';
import { Scanner } from './packing/scanner.service';

@Module({
  providers: [ShopBus, PackBoard, AuditFeed, CourierPager, Scanner],
})
export class AppModule {}
