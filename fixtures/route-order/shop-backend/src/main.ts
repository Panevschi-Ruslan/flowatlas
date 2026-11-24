import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // The default adapter, Express: routes are registered in declaration order.
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

void bootstrap();
