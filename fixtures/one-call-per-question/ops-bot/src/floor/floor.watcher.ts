import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface FloorEvent {
  type: string;
  table?: number;
  note?: string;
}

/** Sends a runner to the table that asked; reads the table and the note it is sent. */
@Injectable()
export class FloorWatcher {
  @Consumes('floor_events')
  onFloorEvent(evt: FloorEvent): string | undefined {
    if (evt.type !== 'HELP_REQUESTED') return undefined;
    return `table ${evt.table ?? '?'}: ${evt.note ?? ''}`;
  }
}
