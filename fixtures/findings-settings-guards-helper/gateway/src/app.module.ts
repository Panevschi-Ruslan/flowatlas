import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { NotesClient } from './clients/notes.client';
import { NotesController } from './notes/notes.controller';

@Module({
  imports: [HttpModule, ConfigModule.forRoot({ ignoreEnvFile: true })],
  controllers: [NotesController],
  providers: [NotesClient],
})
export class AppModule {}
