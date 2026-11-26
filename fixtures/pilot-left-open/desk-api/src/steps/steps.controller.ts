import { Body, Controller, Get, Param, Post, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';

import { TenantBus } from '../bus/tenant-bus.service';
import { StepsService } from './steps.service';

/** The routes the staff screens and the floor tablets call, and the stream the screens hold open. */
@Controller('api/:tenantId')
export class StepsController {
  constructor(
    private readonly steps: StepsService,
    private readonly bus: TenantBus,
  ) {}

  @Post('rooms/:roomNumber/call')
  call(@Param('tenantId') tenantId: string, @Param('roomNumber') roomNumber: string, @Body() body: { orderId: string }): void {
    this.steps.callStaff(tenantId, roomNumber, body.orderId);
  }

  @Post('orders/:orderId/steps/:step/ready')
  ready(
    @Param('tenantId') tenantId: string,
    @Param('orderId') orderId: string,
    @Param('step') step: string,
    @Body() body: { sessionId: string; stepName: string },
  ): void {
    this.steps.stepReady(tenantId, body.sessionId, orderId, step, body.stepName);
  }

  @Post('orders/:orderId/move')
  move(@Param('tenantId') tenantId: string, @Param('orderId') orderId: string, @Body() body: { tableId: string }): void {
    this.steps.moveOrder(tenantId, orderId, body.tableId);
  }

  @Post('tables/:tableId/move')
  moveTable(@Param('tenantId') tenantId: string, @Param('tableId') tableId: string): void {
    this.steps.moveTable(tenantId, tableId);
  }

  @Post('tables/:tableId/merge')
  merge(@Param('tenantId') tenantId: string, @Param('tableId') tableId: string): void {
    this.steps.mergeTables(tenantId, tableId);
  }

  @Post('resync')
  resync(@Param('tenantId') tenantId: string): void {
    this.steps.resync(tenantId);
  }

  @Get('orders/:orderId')
  order(@Param('orderId') orderId: string): { id: string; steps: string[] } {
    return { id: orderId, steps: [] };
  }

  @Sse('stream')
  stream(@Param('tenantId') tenantId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      this.bus.subscribe(`tenant:${tenantId}:events`, (message: unknown) => subscriber.next({ data: message } as MessageEvent));
    });
  }
}
