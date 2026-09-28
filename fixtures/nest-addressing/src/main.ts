import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configure } from './setup';

/**
 * The entry file, and it says nothing about where any route answers.
 *
 * That is the point of this fixture. A repository of any size keeps the
 * application's configuration in a helper so that its tests and its several
 * workers can share one copy, and the file named `main.ts` then holds a
 * factory call and a `listen`. Reading only this file read neither the prefix
 * nor the versioning, and every address in the service came out wrong (R89).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await configure(app);
  await app.listen(3000);
}

void bootstrap();
