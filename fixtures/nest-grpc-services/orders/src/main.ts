import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.GRPC,
    options: {
      package: 'orders',
      protoPath: join(__dirname, '../../proto/orders.proto'),
      url: '0.0.0.0:5000',
    },
  });
  await app.listen();
}

void bootstrap();
