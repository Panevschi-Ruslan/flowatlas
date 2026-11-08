import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import appConfig from './app.config';
import { AppModule } from './app.module';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(config.port);
};

void bootstrap();
