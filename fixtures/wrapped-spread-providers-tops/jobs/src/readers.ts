import { Inject, Injectable, Module } from '@nestjs/common';
import { catalogApi, Reader, SHARED_PROVIDERS } from './shared';

/** Injected by a token a spread list provides with an instance made by `new`; typed as nothing. */
@Injectable()
export class Levels {
  constructor(@Inject('LEVELS_READER') private reader) {}

  onModuleInit() {
    return this.reader.read('/levels');
  }
}

/** Injected by a token whose provider hands on another's (`useExisting`). */
@Injectable()
export class Mirror {
  constructor(@Inject('MIRROR_READER') private reader) {}

  onModuleInit() {
    return this.reader.read('/mirror');
  }
}

/** Listed by the list a function returns. */
@Injectable()
export class Summary {
  constructor(@Inject('CATALOG_READER') private reader) {}

  onModuleInit() {
    return this.reader.read('/summary');
  }
}

/** Providers a function builds. */
function moreProviders() {
  return [Summary, { provide: 'CATALOG_READER', useValue: new Reader(catalogApi) }];
}

@Module({
  providers: [...SHARED_PROVIDERS, ...moreProviders(), Levels, Mirror],
})
export class ReadersModule {}
