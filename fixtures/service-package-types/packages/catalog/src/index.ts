import { Controller, Get, Param } from '@nestjs/common';

/** A library's controller: the API that declares the package serves it. */
@Controller('catalog')
export class CatalogController {
  @Get(':sku')
  find(@Param('sku') sku: string): { sku: string } {
    return { sku };
  }
}
