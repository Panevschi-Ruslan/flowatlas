import { Module } from '@nestjs/common';
import { ImageProcessor } from './image.processor';
import { MailProcessor } from './mail.processor';

@Module({
  providers: [MailProcessor, ImageProcessor],
})
export class AppModule {}
