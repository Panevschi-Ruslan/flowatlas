import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Partitioners } from 'kafkajs';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // `Transport.KAFKA` here is the source half of the `nestjs-kafka` detection
  // rule (§7); `kafkajs` in `package.json` is the other half.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: { clientId: 'orders', brokers: ['localhost:9092'] },
      producer: { createPartitioner: Partitioners.LegacyPartitioner },
    },
  });
  await app.startAllMicroservices();
  await app.listen(3000);
}

void bootstrap();
