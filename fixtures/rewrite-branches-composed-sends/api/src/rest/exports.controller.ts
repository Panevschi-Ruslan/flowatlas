import { Controller, Get } from '@nestjs/common';

@Controller('exports')
export class ExportsController {
  @Get('orders.csv')
  orders(): string {
    return '';
  }
}
