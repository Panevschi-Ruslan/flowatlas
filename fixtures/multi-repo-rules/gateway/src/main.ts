import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

// No `setGlobalPrefix` anywhere in this project: every entry path is exactly the
// path a client writes, so the global-prefix row of P05 §10 is not exercised
// here and belongs to a unit test.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

void bootstrap();
