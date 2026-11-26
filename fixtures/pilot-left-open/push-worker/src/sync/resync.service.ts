import { Injectable } from '@nestjs/common';

/** The type a tenant's full resync is sent as, exported beside the service that answers it. */
export const RESYNC_EVENT = 'RESYNC';

@Injectable()
export class ResyncService {
  resync(scopeId: string): void {
    void scopeId;
  }
}
