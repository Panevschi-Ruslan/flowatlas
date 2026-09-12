import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * The prefix the Nest side is served under.
 *
 * The worker writes `/api` out in every path it declares, because a route
 * declared on the worker is not passed through the framework that adds it. Both
 * halves end up at the same address; only one of them says so at start-up.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  await app.listen(3000);
}

void bootstrap();
