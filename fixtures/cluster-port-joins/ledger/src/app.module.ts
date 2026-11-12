import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './app.config';
import { EntriesController } from './entries.controller';

@Module({ imports: [ConfigModule.forRoot({ load: [appConfig] })], controllers: [EntriesController] })
export class AppModule {}
