import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

const start = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3009);
};

void start();
