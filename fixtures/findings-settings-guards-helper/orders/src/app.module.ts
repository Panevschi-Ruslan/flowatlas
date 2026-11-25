import { Module } from '@nestjs/common';

import { NotesController } from './notes/notes.controller';

@Module({
  controllers: [NotesController],
})
export class AppModule {}
