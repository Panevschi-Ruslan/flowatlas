import { Module } from '@nestjs/common';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

// A real repo would also list `TypeOrmModule.forFeature([Order])` here; the fixture
// leaves it out because `@nestjs/typeorm` is not stubbed and module wiring is not what
// P03 reads — the repository types come from the constructor parameters.
@Module({
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
