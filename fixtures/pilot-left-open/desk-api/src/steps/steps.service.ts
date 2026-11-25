import { Injectable } from '@nestjs/common';

import { TenantBus } from '../bus/tenant-bus.service';

/**
 * The publisher. Every message about a tenant goes on `tenant:<id>:events`,
 * told apart by `type`. `STEP_READY` is sent on four more channels too: the
 * session's three (`closed`, `paid`, `split`) and `status_feed`, where the
 * chat bot reads it.
 */
@Injectable()
export class StepsService {
  constructor(private readonly bus: TenantBus) {}

  callStaff(tenantId: string, roomNumber: string, orderId: string): void {
    this.bus.publish(`tenant:${tenantId}:events`, { type: 'CALL_STAFF', roomNumber, orderId, scopeId: tenantId, ts: new Date().toISOString() });
  }

  stepReady(tenantId: string, sessionId: string, orderId: string, step: string, stepName: string): void {
    this.bus.publish(`tenant:${tenantId}:events`, { type: 'STEP_READY', orderId, step, stepName, scopeId: tenantId });
    this.bus.publish(`session:${sessionId}:closed`, { type: 'STEP_READY', orderId, step, stepName });
    this.bus.publish(`session:${sessionId}:paid`, { type: 'STEP_READY', orderId, step, stepName });
    this.bus.publish(`session:${sessionId}:split`, { type: 'STEP_READY', orderId, step, stepName });
    this.bus.publish('status_feed', { type: 'STEP_READY', orderId, step, stepName });
  }

  moveOrder(tenantId: string, orderId: string, tableId: string): void {
    this.bus.publish(`tenant:${tenantId}:events`, { type: 'ORDER_MOVED', orderId, tableId, scopeId: tenantId });
  }

  moveTable(tenantId: string, tableId: string): void {
    this.bus.publish(`tenant:${tenantId}:events`, { type: 'TABLE_MOVED', tableId, scopeId: tenantId });
  }

  mergeTables(tenantId: string, tableId: string): void {
    this.bus.publish(`tenant:${tenantId}:events`, { type: 'TABLE_MERGED', tableId, scopeId: tenantId });
  }

  resync(tenantId: string): void {
    this.bus.publish(`tenant:${tenantId}:events`, { type: 'RESYNC', scopeId: tenantId });
  }
}
