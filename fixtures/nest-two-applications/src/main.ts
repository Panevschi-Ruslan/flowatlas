import { NestFactory } from '@nestjs/core';

import { ApiModule } from './api/api.module';

/**
 * The application most of this repository is about.
 *
 * It is not the only one. The worker beside it is created by its own file, which
 * nothing reachable from here mentions, and that is the ordinary shape: a
 * supervisor forks the worker by path.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule);
  await app.listen(3000);
}

void bootstrap();
