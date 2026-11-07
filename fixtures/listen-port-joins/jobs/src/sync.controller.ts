import { Controller, Post } from '@nestjs/common';

/**
 * A job that asks stock on this machine for a count, and pings a port nothing
 * here listens on. The first joins stock by its port; the second stays a
 * third party.
 */
@Controller('sync')
export class SyncController {
  @Post('stock')
  async stock(): Promise<unknown> {
    const response = await fetch('http://0.0.0.0:3002/stock/ABC-1');
    return response.json();
  }

  @Post('ping')
  ping(): Promise<Response> {
    return fetch('http://localhost:4999/health');
  }
}
