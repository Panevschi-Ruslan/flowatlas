import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/** The ledger listens on 3005, which audit's example environment file names too. */
const start = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  await app.listen(3005);
};

void start();
