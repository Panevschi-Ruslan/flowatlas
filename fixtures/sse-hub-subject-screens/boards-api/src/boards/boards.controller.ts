import { Body, Controller, Param, Post } from '@nestjs/common';

import { BoardsService } from './boards.service';
import { CardEventsService } from './card-events.service';
import { OrdersService } from './orders.service';

@Controller('boards')
export class BoardsController {
  constructor(
    private readonly boards: BoardsService,
    private readonly cards: CardEventsService,
    private readonly orders: OrdersService,
  ) {}

  @Post(':boardId/orders/:orderId')
  placeOrder(@Param('boardId') boardId: string, @Param('orderId') orderId: string): Promise<void> {
    return this.orders.place(boardId, orderId);
  }

  @Post(':boardId/orders/:orderId/ship')
  shipOrder(@Param('boardId') boardId: string, @Param('orderId') orderId: string): Promise<void> {
    return this.orders.ship(boardId, orderId);
  }

  @Post(':boardId/orders/:orderId/alert')
  alertOrder(@Param('boardId') boardId: string, @Param('orderId') orderId: string): Promise<void> {
    return this.orders.scheduleAlert(boardId, orderId);
  }

  @Post(':boardId/cards/:cardId/pin')
  pin(@Param('boardId') boardId: string, @Param('cardId') cardId: string): Promise<void> {
    return this.cards.pin(boardId, cardId);
  }

  @Post(':boardId/cards/import')
  importCard(@Param('boardId') boardId: string): Promise<void> {
    return this.cards.importCard(boardId);
  }

  @Post(':boardId/cards/:cardId/move')
  move(@Param('boardId') boardId: string, @Param('cardId') cardId: string, @Body() body: { column: string }): Promise<void> {
    return this.boards.moveCard(boardId, cardId, body.column);
  }

  @Post(':boardId/cards')
  add(@Param('boardId') boardId: string, @Body() body: { cardId: string }): Promise<void> {
    return this.boards.addCard(boardId, body.cardId);
  }

  @Post(':boardId/cards/:cardId/archive')
  archive(@Param('boardId') boardId: string, @Param('cardId') cardId: string): Promise<void> {
    return this.boards.archiveCard(boardId, cardId);
  }

  @Post(':boardId/title')
  rename(@Param('boardId') boardId: string, @Body() body: { title: string }): Promise<void> {
    return this.boards.renameBoard(boardId, body.title);
  }

  @Post(':boardId/cards/:cardId/comments')
  comment(@Param('boardId') boardId: string, @Param('cardId') cardId: string, @Body() body: { text: string }): Promise<void> {
    return this.boards.commentOnCard(boardId, cardId, body.text);
  }

  @Post(':boardId/audit')
  audit(@Param('boardId') boardId: string, @Body() body: { actor: string }): Promise<void> {
    return this.boards.auditBoard(boardId, body.actor);
  }

  @Post(':boardId/crews/:crewId')
  assign(@Param('boardId') boardId: string, @Param('crewId') crewId: string): Promise<void> {
    return this.boards.assignCrew(crewId, boardId);
  }
}
