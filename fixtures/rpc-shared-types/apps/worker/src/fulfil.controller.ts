import { Body, Controller, Post } from '@nestjs/common';
import { FulfilService } from './fulfil.service';

@Controller('fulfil')
export class FulfilController {
  constructor(private readonly fulfilment: FulfilService) {}

  @Post()
  fulfil(@Body() body: { sku: string; quantity: number }) {
    return this.fulfilment.fulfil(body.sku, body.quantity);
  }
}
