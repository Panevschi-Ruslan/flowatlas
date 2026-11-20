import { Body, Controller, Param, Post } from '@nestjs/common';

import { SpacesService } from './spaces.service';

@Controller('spaces/:spaceId')
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Post('docs/:docId/publish')
  publish(@Param('spaceId') spaceId: string, @Param('docId') docId: string): void {
    this.spaces.publishDoc(spaceId, docId);
  }

  @Post('docs/:docId/comments')
  comment(@Param('spaceId') spaceId: string, @Param('docId') docId: string, @Body() body: { commentId: string }): void {
    this.spaces.addComment(spaceId, docId, body.commentId);
  }

  @Post('members')
  join(@Param('spaceId') spaceId: string, @Body() body: { memberId: string }): void {
    this.spaces.join(spaceId, body.memberId);
  }

  @Post('exports/:jobId/done')
  exportDone(@Param('spaceId') spaceId: string, @Param('jobId') jobId: string, @Body() body: { url: string }): void {
    this.spaces.finishExport(spaceId, jobId, body.url);
  }

  @Post('quota')
  quota(@Param('spaceId') spaceId: string, @Body() body: { usedBytes: number }): void {
    this.spaces.warnQuota(spaceId, body.usedBytes);
  }
}
