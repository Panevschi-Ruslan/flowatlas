import { Module } from '@nestjs/common';

import { EntriesController } from './entries.controller';

@Module({ controllers: [EntriesController] })
export class AppModule {}
