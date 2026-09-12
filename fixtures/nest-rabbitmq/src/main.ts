import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: { urls: ['amqp://localhost:5672'], queue: 'orders-rpc-q' },
  });
  await app.startAllMicroservices();
  await app.listen(3000);
}

void bootstrap();
