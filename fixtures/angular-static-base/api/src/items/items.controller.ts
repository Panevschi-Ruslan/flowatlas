import { Controller, Get, Param, Post } from '@nestjs/common';

/**
 * The three routes the browser half of this fixture asks for.
 *
 * Nothing here is unusual, on purpose. The whole fixture is about the client
 * side: these routes exist so that a request whose address was read has
 * something real to be joined to, and so that one that was not read can be seen
 * to join nothing.
 */
@Controller('items')
export class ItemsController {
  @Get()
  list(): unknown[] {
    return [];
  }

  @Get(':id')
  findOne(@Param('id') id: string): unknown {
    return { id };
  }

  @Post('pay')
  pay(): unknown {
    return {};
  }
}
