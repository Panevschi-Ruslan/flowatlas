import { NestFactory, Reflector } from '@nestjs/core';

import { AppModule } from './app.module';
import { ApiKeyGuard } from './auth/api-key.guard';

/** Expected: every route behind `ApiKeyGuard`, `where: global`, `via: useGlobalGuards in src/main.ts`. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new ApiKeyGuard(app.get(Reflector)));
  await app.listen(3000);
}

void bootstrap();
