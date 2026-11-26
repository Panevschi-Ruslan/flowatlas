import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface ItemChangedEvent {
  itemId: string;
  kind: 'created' | 'updated';
}

const assertNever = (value: never): never => {
  throw new Error(`unhandled ${String(value)}`);
};

/** Tells the shop floor an item changed: switches over `kind`, a case for each, and proves none is left. */
@Injectable()
export class NotifyService {
  @Consumes('item.changed')
  onItemChanged(evt: ItemChangedEvent): void {
    switch (evt.kind) {
      case 'created':
        this.announce(evt.itemId, 'new');
        break;
      case 'updated':
        this.announce(evt.itemId, 'changed');
        break;
      default:
        assertNever(evt.kind);
    }
  }

  announce(itemId: string, text: string): void {
    console.log(`${itemId}: ${text}`);
  }
}
