import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { TemplatesService } from './notifications/templates.service.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, TemplatesService],
})
export class AppModule {}
