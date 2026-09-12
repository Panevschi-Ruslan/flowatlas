import { Injectable } from '@nestjs/common';

import { Cache } from '../tokens';

@Injectable()
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, string>();

  get(key: string): string {
    return this.entries.get(key) ?? '';
  }
}
