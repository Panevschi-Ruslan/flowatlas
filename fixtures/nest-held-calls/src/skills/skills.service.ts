import { Injectable } from '@nestjs/common';

import { buildGithubHeaders, fetchSkillBundle, repoSlug } from './github-bundle';

@Injectable()
export class SkillsService {
  /**
   * Calls two helpers by name: `repoSlug` holds nothing and reaches nothing,
   * `fetchSkillBundle` holds nothing itself and reaches a request.
   */
  bundle(repository: string): Promise<string> {
    return fetchSkillBundle(repoSlug(repository));
  }

  /** Calls, by name, a function that holds a configuration read. */
  hasToken(): boolean {
    return buildGithubHeaders().authorization !== undefined;
  }
}
