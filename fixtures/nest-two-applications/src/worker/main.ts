import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

/**
 * The second application, created in a file nothing else in the repository
 * imports.
 *
 * Which is why the reading has to walk the repository rather than follow calls
 * out of the file named `main.ts`: a supervisor starts this one by path, and
 * nothing static leads here from there.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule);
  await app.listen(3001);
}

void bootstrap();
