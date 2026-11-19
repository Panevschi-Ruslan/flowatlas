import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailQueueService } from './mail/mail-queue.service';
import { OrdersController } from './mail/orders.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail-queue' }, { name: 'image-queue' })],
  controllers: [OrdersController],
  providers: [MailQueueService],
})
export class AppModule {}
