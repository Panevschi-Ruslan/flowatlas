import { Injectable } from '@nestjs/common';
import { CommentsStore, type Comment } from '../comments/comments.store.js';
import { SearchRepository } from '../search/search.repository.js';
import { CookbooksRepository } from './cookbooks.repository.js';
import { DraftsRepository } from './drafts.repository.js';
import { RecipesRepository, type Recipe } from './recipes.repository.js';
import { TagsRepository } from './tags.repository.js';

@Injectable()
export class RecipesService {
  constructor(
    private readonly recipesRepository: RecipesRepository,
    private readonly tagsRepository: TagsRepository,
    private readonly draftsRepository: DraftsRepository,
    private readonly comments: CommentsStore,
    private readonly searchRepository: SearchRepository,
    private readonly cookbooksRepository: CookbooksRepository,
  ) {}

  // Through the base read without configuration: `recipes`.
  list(): Promise<Recipe[]> {
    return this.recipesRepository.findAll();
  }

  // A finder the subclass declares: `recipes`.
  popular(): Promise<Recipe[]> {
    return this.recipesRepository.findPopular();
  }

  // `tags`, heuristic: the field is not readonly.
  tags(): Promise<unknown> {
    return this.tagsRepository.findAll();
  }

  // The drafts table is chosen at run time: one row naming DraftsRepository.
  drafts(): Promise<unknown> {
    return this.draftsRepository.findAll();
  }

  // Two bases down: `cookbooks`, through a method of either base.
  cookbooks(): Promise<unknown> {
    return this.cookbooksRepository.findAll();
  }

  newestCookbooks(): Promise<unknown> {
    return this.cookbooksRepository.findLatest();
  }

  comment(comment: Comment): Promise<unknown> {
    return this.comments.add(comment);
  }

  // Named like data and drawn as a static call into SearchRepository.lookup,
  // where the query is read: no row here, and counted.
  search(term: string): Promise<unknown> {
    return this.searchRepository.lookup(term);
  }
}
