import { Module } from '@nestjs/common';
import { BackOfficeController } from './back-office.controller';
import { BuildBot } from './builds/build-bot';
import { BuildRelayController } from './builds/build-relay.controller';
import { StoresClient } from './stores.client';

@Module({
  controllers: [BackOfficeController, BuildRelayController],
  providers: [StoresClient, BuildBot],
})
export class AppModule {}
