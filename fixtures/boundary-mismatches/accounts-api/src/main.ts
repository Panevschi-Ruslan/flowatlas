import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // The shop's own origin by name, with credentials: a credentialed request is answered.
  const app = await NestFactory.create(AppModule, {
    cors: { origin: ['https://shop.example.test'], credentials: true },
  });
  await app.listen(3001);
}

void bootstrap();
