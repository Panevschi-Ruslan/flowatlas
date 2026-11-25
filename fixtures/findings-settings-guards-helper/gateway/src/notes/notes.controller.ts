import { Controller, Delete, Get, Param, Post } from '@nestjs/common';

import { NotesClient } from '../clients/notes.client';

/** The notes the storefront asks the gateway for. */
@Controller('api/notes')
export class NotesController {
  constructor(private readonly notes: NotesClient) {}

  @Get()
  list() {
    return this.notes.list();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notes.remove(id);
  }

  @Post(':id/export')
  export(@Param('id') id: string) {
    return this.notes.export(id);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.notes.archive(id);
  }
}
