import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { TenantBus } from '../bus/tenant-bus.service';
import { PushSender } from '../push/push-sender.service';

interface StatusEvent {
  type: string;
  stepName?: string;
}

/** Reads `stepName` of `STEP_READY` on `status_feed`, the last of the five channels carrying the type. */
@Injectable()
export class ChatBot implements OnModuleInit {
  constructor(
    private readonly bus: TenantBus,
    private readonly sender: PushSender,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('status_feed', (raw: string) => {
      const evt = JSON.parse(raw) as StatusEvent;
      if (evt.type === 'STEP_READY') this.handleStepReady(evt);
    });
  }

  handleStepReady(evt: StatusEvent): void {
    void this.sender.send('staff', `${evt.stepName ?? 'a step'} is ready`);
  }
}
