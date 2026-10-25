import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

export interface Item {
  id: string;
  title: string;
  price: number;
}

/**
 * The bookshop's catalogue.
 *
 * Every route but two is called from somewhere in the project, each through a
 * shape the reader used to miss: a wrapper handed the verb, a URL helper's
 * default argument, a worker's binding, an annotation naming the service by
 * its alias, a variable holding a whole address. `export` is called by
 * nothing; `price` by nothing anybody read in full.
 */
@Controller('items')
export class ItemsController {
  @Get()
  list(): Item[] {
    return [];
  }

  @Get('export')
  exportAll(): string {
    return '';
  }

  @Post('reindex')
  reindex(): { queued: boolean } {
    return { queued: true };
  }

  @Get(':id')
  one(@Param('id') id: string): Item {
    return { id, title: '', price: 0 };
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: { title: string }): Item {
    return { id, title: body.title, price: 0 };
  }

  @Delete(':id')
  remove(@Param('id') id: string): void {
    void id;
  }

  @Get(':id/price')
  price(@Param('id') id: string): { id: string; price: number } {
    return { id, price: 0 };
  }
}
