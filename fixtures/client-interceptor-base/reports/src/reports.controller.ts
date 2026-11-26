import { Controller, Get, Post } from '@nestjs/common';

/**
 * Reports read billing's items by the host billing is reached at, and send a
 * charge to a third party. The first joins billing through `services[].hosts`;
 * the second stays external.
 */
@Controller('reports')
export class ReportsController {
  @Get()
  async summary(): Promise<unknown> {
    const response = await fetch('https://billing.example.test/items');
    return response.json();
  }

  @Post('charge')
  charge(): Promise<Response> {
    return fetch('https://payments.example.test/charge', { method: 'POST' });
  }
}
