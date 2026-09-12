import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { ApiKeyGuard } from './guards/api-key.guard';

/**
 * The global guard lives here, which is what makes this file global: every
 * route in the repository is wrapped by what this line installs.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new ApiKeyGuard());
  await app.listen(3000);
}

void bootstrap();
