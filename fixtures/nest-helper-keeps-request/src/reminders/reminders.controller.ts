import { Controller, Param, Post } from '@nestjs/common';

import { RemindersService } from './reminders.service';

@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post(':chatId/desk')
  desk(@Param('chatId') chatId: string): Promise<boolean> {
    return this.reminders.remindAtDesk(chatId);
  }
}
