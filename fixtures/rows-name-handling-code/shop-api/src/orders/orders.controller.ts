import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { ClientGuard } from '../auth/client.guard';
import { NoteGuard } from '../auth/note.guard';
import { ShopOpenGuard } from '../auth/shop-open.guard';
import { OrdersService } from './orders.service';

interface CancelOrderBody {
  userRef?: string;
}

interface NoteBody {
  note: string;
}

@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The body is declared and never read here: the guard's own method reads `userRef`, under a key it holds as a default. */
  @Patch(':id/cancel')
  @UseGuards(ClientGuard, ShopOpenGuard)
  async cancel(@Param('id') id: string, @Body() _body: CancelOrderBody): Promise<void> {
    await this.orders.cancel(id, 'client');
  }

  /** The guard's helper copies the whole body away: a use the reading cannot follow, said with the method it is in. */
  @Patch(':id/note')
  @UseGuards(NoteGuard)
  note(@Param('id') id: string, @Body() body: NoteBody): void {
    this.orders.addNote(id, body.note);
  }

  @Post(':id/expire')
  async expire(@Param('id') id: string): Promise<void> {
    await this.orders.expire(id);
  }
}
