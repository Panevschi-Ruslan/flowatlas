import { NestFactory } from '@nestjs/core';

import { OrdersModule } from './orders.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(OrdersModule);
  await app.listen(3001);
}

void bootstrap();
