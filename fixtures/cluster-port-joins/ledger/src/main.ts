import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { Server } from './server';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  await app.get(Server).start(app);
};

void bootstrap();
