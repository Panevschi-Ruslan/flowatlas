import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { Comment } from '../comments/comments.store.js';
import { RecipesService } from './recipes.service.js';

@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  list(): Promise<unknown> {
    return this.recipes.list();
  }

  @Get('popular')
  popular(): Promise<unknown> {
    return this.recipes.popular();
  }

  @Get('tags')
  tags(): Promise<unknown> {
    return this.recipes.tags();
  }

  @Get('drafts')
  drafts(): Promise<unknown> {
    return this.recipes.drafts();
  }

  @Get('cookbooks')
  cookbooks(): Promise<unknown> {
    return this.recipes.cookbooks();
  }

  @Get('cookbooks/newest')
  newestCookbooks(): Promise<unknown> {
    return this.recipes.newestCookbooks();
  }

  @Get('search')
  search(@Query('q') term: string): Promise<unknown> {
    return this.recipes.search(term);
  }

  @Post('comments')
  comment(@Body() comment: Comment): Promise<unknown> {
    return this.recipes.comment(comment);
  }
}
