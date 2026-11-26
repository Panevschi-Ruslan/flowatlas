import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EnvelopeInterceptor } from './envelope.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Every answer goes out as { success, data }.
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.listen(3000);
}

void bootstrap();
