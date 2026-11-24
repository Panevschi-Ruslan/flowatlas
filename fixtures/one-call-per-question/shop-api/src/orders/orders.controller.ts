import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ClientGuard } from '../auth/client.guard';
import { OrdersService } from './orders.service';

interface CancelOrderBody {
  userRef?: string;
}

interface ReadyBody {
  label: string;
  printer?: string;
}

interface NoteBody {
  text: string;
  pinned?: boolean;
}

/** The shop's orders: a class long enough that its skeleton says more than its bodies. */
@Controller('api/orders')
export class OrdersController {
  private readonly notes = new Map<string, string[]>();

  constructor(private readonly orders: OrdersService) {}

  /** The body is declared and never read here: the guard in front of the route reads it. */
  @Patch(':orderId/cancel')
  @UseGuards(ClientGuard)
  async cancel(@Param('orderId') orderId: string, @Body() _body: CancelOrderBody): Promise<void> {
    await this.orders.cancel(orderId, 'cancelled by the client');
  }

  @Post(':orderId/ready')
  async ready(@Param('orderId') orderId: string, @Body() body: ReadyBody): Promise<void> {
    await this.orders.markReady(orderId, body.label);
  }

  @Post(':orderId/notes')
  addNote(@Param('orderId') orderId: string, @Body() body: NoteBody): number {
    const kept = this.notes.get(orderId) ?? [];
    const text = body.pinned === true ? `[pinned] ${body.text}` : body.text;
    kept.push(text);
    this.notes.set(orderId, kept);
    return kept.length;
  }

  @Get(':orderId/notes')
  listNotes(@Param('orderId') orderId: string): string[] {
    const kept = this.notes.get(orderId) ?? [];
    return [...kept].sort((a, b) => {
      const pinnedA = a.startsWith('[pinned]') ? 0 : 1;
      const pinnedB = b.startsWith('[pinned]') ? 0 : 1;
      return pinnedA - pinnedB;
    });
  }
}
