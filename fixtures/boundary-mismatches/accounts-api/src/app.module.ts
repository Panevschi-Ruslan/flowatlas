import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AccountsController } from './accounts/accounts.controller';
import { settingsSchema } from './settings';

/** The settings are validated with a schema, which may give a key a default. */
@Module({
  imports: [ConfigModule.forRoot({ validationSchema: settingsSchema })],
  controllers: [AccountsController],
})
export class AppModule {}
