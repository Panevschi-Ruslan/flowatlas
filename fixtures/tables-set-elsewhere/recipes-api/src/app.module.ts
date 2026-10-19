import { Module } from '@nestjs/common';
import { CommentsStore } from './comments/comments.store.js';
import { MongoConnection } from './db/connection.js';
import { CookbooksRepository } from './recipes/cookbooks.repository.js';
import { DraftsRepository } from './recipes/drafts.repository.js';
import { RecipesController } from './recipes/recipes.controller.js';
import { RecipesRepository } from './recipes/recipes.repository.js';
import { RecipesService } from './recipes/recipes.service.js';
import { TagsRepository } from './recipes/tags.repository.js';
import { SearchRepository } from './search/search.repository.js';
import { SettingsService } from './settings/settings.service.js';

@Module({
  controllers: [RecipesController],
  providers: [
    MongoConnection,
    SettingsService,
    RecipesRepository,
    TagsRepository,
    DraftsRepository,
    CookbooksRepository,
    CommentsStore,
    SearchRepository,
    RecipesService,
  ],
})
export class AppModule {}
