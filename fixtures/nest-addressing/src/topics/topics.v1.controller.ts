import { Controller, Get, Param } from '@nestjs/common';

/**
 * The older half of one resource at two versions.
 *
 * Its address is `/api/v1/topics`. Recorded as `/api/topics` it lands on the same
 * entry as the controller next door, and the tool then reports the route as
 * claimed by two handlers — a warning about a collision that does not exist.
 */
@Controller({ path: 'topics', version: '1' })
export class TopicsV1Controller {
  @Get()
  list(): string[] {
    return [];
  }

  @Get(':id')
  one(@Param('id') id: string): string {
    return id;
  }
}
