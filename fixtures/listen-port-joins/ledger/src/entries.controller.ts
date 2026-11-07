import { Controller, Get } from '@nestjs/common';

@Controller('entries')
export class EntriesController {
  @Get()
  list(): unknown[] {
    return [];
  }
}
