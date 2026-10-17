import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // The listener the `@EventPattern` handlers hang off. `orders` publishes
  // through the matching client; the transport is incidental to the linker.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: { host: 'localhost', port: 4001 },
  });
  await app.startAllMicroservices();
  await app.listen(3002);
}

void bootstrap();
