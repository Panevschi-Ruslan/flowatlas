import { Controller, Get, Param } from '@nestjs/common';

@Controller('api/catalog')
export class CatalogController {
  @Get('items/:id')
  item(@Param('id') id: string): { id: string } {
    return { id };
  }
}
