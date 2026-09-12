import { Injectable } from '@nestjs/common';

import { Cache } from '../tokens';

@Injectable()
export class RedisCache implements Cache {
  get(key: string): string {
    return `redis:${key}`;
  }
}
