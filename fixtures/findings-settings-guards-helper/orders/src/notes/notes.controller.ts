import { Controller, Delete, Get, Param, Post } from '@nestjs/common';

export interface Note {
  id: string;
  text: string;
  exported: boolean;
}

/** An order's notes. */
@Controller('notes')
export class NotesController {
  private readonly notes = new Map<string, Note>();

  @Get()
  list(): Note[] {
    return [...this.notes.values()];
  }

  @Delete(':id')
  remove(@Param('id') id: string): void {
    this.notes.delete(id);
  }

  @Post(':id/export')
  export(@Param('id') id: string): Note | undefined {
    const note = this.notes.get(id);
    if (note !== undefined) note.exported = true;
    return note;
  }
}
