import { Controller, Delete, Param, Post } from '@nestjs/common';
import type { Message } from './message.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post(':name')
  greet(@Param('name') name: string): Message {
    return this.notifications.greet(name);
  }

  @Delete(':name')
  dismiss(@Param('name') name: string): Message {
    return this.notifications.dismiss(name);
  }
}
