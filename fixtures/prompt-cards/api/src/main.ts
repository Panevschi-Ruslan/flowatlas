import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Every route is served under this prefix.
  app.setGlobalPrefix('api');
  await app.listen(3000);
}

void bootstrap();
