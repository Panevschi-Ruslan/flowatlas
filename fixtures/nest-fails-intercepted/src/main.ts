import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';
import { ShopErrorFilter } from './shop-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new TimeoutInterceptor());
  app.useGlobalFilters(new ShopErrorFilter());
  await app.listen(3000);
}

void bootstrap();
