import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { mergeConfig, type ServerConfig } from './config/merge';

/** Starts the server on the port the merged configuration holds, which no setting of this repository writes. */
export async function bootstrap(given: Partial<ServerConfig> = {}): Promise<void> {
  const config = mergeConfig(given);
  const { hostname, port } = config.apiOptions;
  const app = await NestFactory.create(AppModule);
  await app.listen(port, hostname);
}

void bootstrap();
