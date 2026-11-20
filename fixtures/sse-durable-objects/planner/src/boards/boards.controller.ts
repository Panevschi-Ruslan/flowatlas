import { Body, Controller, Param, Post } from '@nestjs/common';
import { BoardsService } from './boards.service';

@Controller()
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Post('boards/:boardId/cards')
  addCard(@Param('boardId') boardId: string, @Body() body: { teamId: string; title: string }): Promise<void> {
    return this.boards.addCard(boardId, body.teamId, body.title);
  }

  @Post('alerts')
  raise(@Body() body: { text: string }): Promise<void> {
    return this.boards.raiseAlert(body.text);
  }

  @Post('digest')
  digest(@Body() body: { summary: string }): Promise<void> {
    return this.boards.sendDigest(body.summary);
  }
}
