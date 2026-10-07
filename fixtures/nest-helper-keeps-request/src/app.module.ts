import { Module } from '@nestjs/common';

import { RemindersController } from './reminders/reminders.controller';
import { RemindersService } from './reminders/reminders.service';

@Module({
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class AppModule {}
