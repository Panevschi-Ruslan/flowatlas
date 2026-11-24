import { Module } from '@nestjs/common';
import { BackOfficeController } from './back-office.controller';
import { StoresClient } from './stores.client';

@Module({
  controllers: [BackOfficeController],
  providers: [StoresClient],
})
export class AppModule {}
