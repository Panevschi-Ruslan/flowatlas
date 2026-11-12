import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

const start = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  await app.listen(4500);
};

void start();
