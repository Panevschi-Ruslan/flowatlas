import { Body, Controller, Post } from '@nestjs/common';
import type { DraftBody } from './item.types';

@Controller('drafts')
export class DraftsController {
  @Post()
  keep(@Body() body: DraftBody): string {
    return `${body.title ?? 'untitled'}: ${body.notes ?? ''}`;
  }
}
