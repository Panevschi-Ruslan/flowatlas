import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { StaffApi } from './staff.api';
import { StaffBot } from './staff-bot';
import { TextRouter } from './text-router';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  providers: [StaffBot, StaffApi, TextRouter],
})
export class AppModule {}
