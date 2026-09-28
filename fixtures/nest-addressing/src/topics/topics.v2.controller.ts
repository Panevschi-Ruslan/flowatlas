import { Controller, Get, Param } from '@nestjs/common';

/** The newer half. Same paths, different version, therefore a different address. */
@Controller({ path: 'topics', version: '2' })
export class TopicsV2Controller {
  @Get()
  list(): string[] {
    return [];
  }

  @Get(':id')
  one(@Param('id') id: string): string {
    return id;
  }
}
