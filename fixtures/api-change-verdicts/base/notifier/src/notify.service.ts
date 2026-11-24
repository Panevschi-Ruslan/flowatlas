import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface ItemChangedEvent {
  itemId: string;
  name: string;
  label: string;
  legacyCode: string;
}

/** Tells the shop floor an item changed: reads the label and the name, never the legacy code. */
@Injectable()
export class NotifyService {
  @Consumes('item.changed')
  onItemChanged(evt: ItemChangedEvent): void {
    this.announce(evt.itemId, `${evt.label} (${evt.name})`);
  }

  announce(itemId: string, text: string): void {
    console.log(`${itemId}: ${text}`);
  }
}
