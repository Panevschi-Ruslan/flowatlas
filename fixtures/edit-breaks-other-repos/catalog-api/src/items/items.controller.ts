import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ItemsService } from './items.service';

interface ArchiveBody {
  reason: string;
}

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  list(): Promise<string[]> {
    return this.items.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<string> {
    return this.items.findOne(id);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string, @Body() body: ArchiveBody): Promise<void> {
    return this.items.archive(id, body.reason);
  }

  @Post(':id/take')
  take(@Param('id') id: string, @Body('count') count: number): Promise<void> {
    return this.items.take(id, count);
  }
}

/** A second controller in the file: its `@Get()` line is the same text as the one above. */
@Controller('tags')
export class TagsController {
  @Get()
  list(): string[] {
    return ['new', 'sale'];
  }
}
