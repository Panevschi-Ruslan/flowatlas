import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface DeskEvent {
  type: string;
  deskId?: number;
  note?: string;
}

/** Pages the floor when a desk asks for help; does nothing without the desk's id. */
@Injectable()
export class NotifyService {
  @Consumes('desk_events')
  onDeskEvent(evt: DeskEvent): void {
    if (evt.type !== 'HELP_REQUESTED') return;
    if (!evt.deskId) return;
    this.page(evt.deskId, evt.note);
  }

  page(deskId: number, note: string | undefined): void {
    console.log(`desk ${deskId} needs help: ${note ?? ''}`);
  }
}
